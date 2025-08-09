// api/translate.js - serverless функция для Vercel

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
      glossary = {}, 
      useInformalTone = false, 
      preferShortForms = false,
      apiKey 
    } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    if (!texts || texts.length === 0) {
      return res.status(400).json({ error: 'No texts to translate' });
    }

    // Формируем контекст для Claude с глоссарием и правилами
    const glossaryText = Object.keys(glossary).length > 0 
      ? `\n\nГлоссарий терминов:\n${Object.entries(glossary).map(([en, ru]) => `- "${en}" → "${ru}"`).join('\n')}`
      : '';

    const editorialRules = [];
    if (useInformalTone) {
      editorialRules.push('- Используй неформальное обращение на "ты" вместо "вы"');
    }
    if (preferShortForms) {
      editorialRules.push('- Предпочитай короткие и ёмкие формулировки');
    }

    const editorialText = editorialRules.length > 0 
      ? `\n\nПравила редполитики:\n${editorialRules.join('\n')}`
      : '';

    const prompt = `Ты — профессиональный переводчик интерфейсов. Переведи следующие тексты с языка "${fromLang}" на "${toLang}".

Контекст: Это тексты пользовательского интерфейса (кнопки, заголовки, сообщения).

Общие правила:
- Сохраняй структуру и форматирование
- Учитывай контекст UI и UX
- Используй принятые термины для интерфейсов
- Если текст уже на целевом языке, оставь как есть
- Будь краток и понятен для пользователей${glossaryText}${editorialText}

Тексты для перевода:
${texts.map((text, i) => `${i + 1}. ${text}`).join('\n')}

Верни ТОЛЬКО переводы в том же порядке, по одному на строку, без нумерации и дополнительных комментариев:`;

    // Отправляем запрос к Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json();
      return res.status(claudeResponse.status).json({ 
        error: errorData.error?.message || 'Claude API error' 
      });
    }

    const claudeData = await claudeResponse.json();
    const translatedText = claudeData.content[0].text.trim();

    // Парсим ответ Claude
    const translations = translatedText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, texts.length);

    // Дополняем недостающие переводы оригинальными текстами
    while (translations.length < texts.length) {
      translations.push(texts[translations.length]);
    }

    res.json({ 
      translations,
      info: {
        originalCount: texts.length,
        translatedCount: translations.length,
        model: 'claude-3-haiku-20240307'
      }
    });

  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: error.message });
  }
}
