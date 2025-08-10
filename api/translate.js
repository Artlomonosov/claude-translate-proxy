// api/translate.js - обновлённая версия для работы с глоссарием
export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка preflight запроса
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { 
      texts, 
      fromLang, 
      toLang, 
      customPrompt = '', 
      glossaryContext = '', // Контекст глоссария
      permanentContext = '', // Для обратной совместимости со старой версией
      apiKey 
    } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }
    
    if (!texts || texts.length === 0) {
      return res.status(400).json({ error: 'No texts to translate' });
    }
    
    // Используем glossaryContext, если есть, иначе permanentContext для совместимости
    const contextText = glossaryContext || permanentContext;
    
    // Формируем контекст для Claude
    const glossaryText = glossaryContext 
      ? `${glossaryContext}`
      : '';
    
    const customContextText = customPrompt 
      ? `\n\nДополнительный контекст для этого фрейма:\n${customPrompt}`
      : '';
    
    // Улучшенный промпт с акцентом на глоссарий
    const prompt = `Ты — профессиональный переводчик интерфейсов. Переведи следующие тексты с языка "${fromLang}" на "${toLang}".

КОНТЕКСТ: Это тексты пользовательского интерфейса (кнопки, заголовки, сообщения, метки).

ОБЩИЕ ПРАВИЛА:
- Сохраняй структуру и форматирование текста
- Учитывай контекст UI/UX интерфейсов
- Используй принятые термины для интерфейсов
- Если текст уже на целевом языке, оставь как есть
- Будь краток и понятен для пользователей
- Сохраняй регистр букв (заглавные/строчные)
- Не добавляй точки в конце, если их не было в оригинале${glossaryText}${customContextText}

ВАЖНО: Если в глоссарии есть переводы терминов, используй ИМЕННО ИХ, даже если знаешь другие варианты перевода.

ТЕКСТЫ ДЛЯ ПЕРЕВОДА:
${texts.map((text, i) => `${i + 1}. ${text}`).join('\n')}

ВЕРНИ ТОЛЬКО ПЕРЕВОДЫ в том же порядке, по одному на строку, без нумерации и дополнительных комментариев:`;
    
    // Определяем модель в зависимости от сложности
    const hasGlossary = glossaryContext && glossaryContext.trim().length > 0;
    const hasCustomPrompt = customPrompt && customPrompt.trim().length > 0;
    const totalTexts = texts.length;
    
    // Используем Haiku для простых случаев, Claude 3.5 Sonnet для сложных
    let model = 'claude-3-haiku-20240307';
    let maxTokens = 4000;
    
    if (hasGlossary || hasCustomPrompt || totalTexts > 20) {
      model = 'claude-3-5-sonnet-20241022';
      maxTokens = 6000;
    }
    
    // Отправляем запрос к Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });
    
    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json();
      console.error('Claude API error:', errorData);
      
      // Более детальная обработка ошибок
      if (claudeResponse.status === 401) {
        return res.status(401).json({ 
          error: 'Неверный API ключ Claude. Проверьте ключ в настройках.' 
        });
      }
      
      if (claudeResponse.status === 429) {
        return res.status(429).json({ 
          error: 'Превышен лимит запросов Claude API. Попробуйте через минуту.' 
        });
      }
      
      return res.status(claudeResponse.status).json({ 
        error: errorData.error?.message || 'Ошибка Claude API' 
      });
    }
    
    const claudeData = await claudeResponse.json();
    const translatedText = claudeData.content[0].text.trim();
    
    // Парсим ответ Claude с улучшенной обработкой
    const rawLines = translatedText.split('\n');
    const translations = [];
    
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      
      // Пропускаем пустые строки и служебные комментарии
      if (line.length === 0) continue;
      if (line.startsWith('//') || line.startsWith('#')) continue;
      if (line.toLowerCase().includes('перевод') && line.includes(':')) continue;
      
      // Убираем нумерацию если она есть
      const cleanLine = line.replace(/^\d+\.\s*/, '').trim();
      
      if (cleanLine.length > 0) {
        translations.push(cleanLine);
      }
      
      // Останавливаемся когда набрали нужное количество
      if (translations.length >= texts.length) {
        break;
      }
    }
    
    // Дополняем недостающие переводы оригинальными текстами
    while (translations.length < texts.length) {
      const missingIndex = translations.length;
      translations.push(texts[missingIndex]);
    }
    
    // Обрезаем лишние переводы если их больше чем нужно
    if (translations.length > texts.length) {
      translations.splice(texts.length);
    }
    
    // Логируем для отладки (только в development)
    console.log('Translation request:', {
      textsCount: texts.length,
      model: model,
      hasGlossary: hasGlossary,
      hasCustomPrompt: hasCustomPrompt,
      translationsCount: translations.length,
      glossaryLength: contextText ? contextText.length : 0
    });
    
    res.json({ 
      translations,
      info: {
        originalCount: texts.length,
        translatedCount: translations.length,
        model: model,
        hasGlossary: hasGlossary,
        hasCustomPrompt: hasCustomPrompt
      }
    });
    
  } catch (error) {
    console.error('Translation error:', error);
    
    // Обработка сетевых ошибок
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'Сервис Claude временно недоступен. Попробуйте позже.' 
      });
    }
    
    // Обработка ошибок парсинга
    if (error instanceof SyntaxError) {
      return res.status(400).json({ 
        error: 'Ошибка обработки данных запроса.' 
      });
    }
    
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера: ' + error.message 
    });
  }
}
