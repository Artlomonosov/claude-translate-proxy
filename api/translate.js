// api/translate.js - версия с кешированием переводов
import { createHash } from 'crypto';

// Простое in-memory хранилище кеша (в продакшене лучше использовать Redis)
export const translationCache = new Map();

// Настройки кеша
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах
const MAX_CACHE_SIZE = 10000; // Максимум записей в кеше

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
      glossaryContext = '',
      permanentContext = '',
      apiKey,
      useCache = true // Новый параметр для включения/отключения кеша
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
    const glossaryText = contextText 
      ? `${contextText}`
      : '';
    
    const customContextText = customPrompt 
      ? `\n\nДополнительный контекст для этого фрейма:\n${customPrompt}`
      : '';
    
    // Определяем модель в зависимости от сложности
    const hasGlossary = contextText && contextText.trim().length > 0;
    const hasCustomPrompt = customPrompt && customPrompt.trim().length > 0;
    const totalTexts = texts.length;
    
    let model = 'claude-3-haiku-20240307';
    let maxTokens = 4000;
    
    if (hasGlossary || hasCustomPrompt || totalTexts > 20) {
      model = 'claude-3-5-sonnet-20241022';
      maxTokens = 6000;
    }
    
    // Кеширование переводов
    let cacheHits = 0;
    let cacheMisses = 0;
    const cachedTranslations = [];
    const textsToTranslate = [];
    const textIndexMapping = []; // Для восстановления порядка
    
    if (useCache) {
      // Очищаем устаревший кеш
      cleanExpiredCache();
      
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const cacheKey = generateCacheKey(text, fromLang, toLang, contextText, customPrompt);
        const cachedResult = translationCache.get(cacheKey);
        
        if (cachedResult && !isCacheExpired(cachedResult.timestamp)) {
          // Найдено в кеше
          cachedTranslations[i] = cachedResult.translation;
          cacheHits++;
        } else {
          // Нет в кеше, нужно перевести
          cachedTranslations[i] = null;
          textsToTranslate.push(text);
          textIndexMapping.push(i);
          cacheMisses++;
        }
      }
      
      console.log(`Cache stats: ${cacheHits} hits, ${cacheMisses} misses`);
    } else {
      // Кеш отключен, переводим все
      textsToTranslate.push(...texts);
      textIndexMapping.push(...texts.map((_, i) => i));
      cacheMisses = texts.length;
    }
    
    let newTranslations = [];
    
    // Переводим только те тексты, которых нет в кеше
    if (textsToTranslate.length > 0) {
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
${textsToTranslate.map((text, i) => `${i + 1}. ${text}`).join('\n')}

ВЕРНИ ТОЛЬКО ПЕРЕВОДЫ в том же порядке, по одному на строку, без нумерации и дополнительных комментариев:`;
      
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
      newTranslations = [];
      
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        
        if (line.length === 0) continue;
        if (line.startsWith('//') || line.startsWith('#')) continue;
        if (line.toLowerCase().includes('перевод') && line.includes(':')) continue;
        
        const cleanLine = line.replace(/^\d+\.\s*/, '').trim();
        
        if (cleanLine.length > 0) {
          newTranslations.push(cleanLine);
        }
        
        if (newTranslations.length >= textsToTranslate.length) {
          break;
        }
      }
      
      // Дополняем недостающие переводы оригинальными текстами
      while (newTranslations.length < textsToTranslate.length) {
        const missingIndex = newTranslations.length;
        newTranslations.push(textsToTranslate[missingIndex]);
      }
      
      if (newTranslations.length > textsToTranslate.length) {
        newTranslations.splice(textsToTranslate.length);
      }
      
      // Сохраняем новые переводы в кеш
      if (useCache) {
        for (let i = 0; i < textsToTranslate.length; i++) {
          const text = textsToTranslate[i];
          const translation = newTranslations[i];
          const cacheKey = generateCacheKey(text, fromLang, toLang, contextText, customPrompt);
          
          // Управляем размером кеша
          if (translationCache.size >= MAX_CACHE_SIZE) {
            const firstKey = translationCache.keys().next().value;
            translationCache.delete(firstKey);
          }
          
          translationCache.set(cacheKey, {
            translation: translation,
            timestamp: Date.now()
          });
        }
      }
    }
    
    // Восстанавливаем полный массив переводов
    const finalTranslations = [...cachedTranslations];
    
    // Вставляем новые переводы в правильные позиции
    for (let i = 0; i < newTranslations.length; i++) {
      const originalIndex = textIndexMapping[i];
      finalTranslations[originalIndex] = newTranslations[i];
    }
    
    // Логируем для отладки
    console.log('Translation request:', {
      textsCount: texts.length,
      model: model,
      hasGlossary: hasGlossary,
      hasCustomPrompt: hasCustomPrompt,
      translationsCount: finalTranslations.length,
      cacheHits: cacheHits,
      cacheMisses: cacheMisses,
      cacheSize: translationCache.size
    });
    
    res.json({ 
      translations: finalTranslations,
      info: {
        originalCount: texts.length,
        translatedCount: finalTranslations.length,
        model: model,
        hasGlossary: hasGlossary,
        hasCustomPrompt: hasCustomPrompt,
        cacheHits: cacheHits,
        cacheMisses: cacheMisses,
        tokensRequired: cacheMisses, // Только новые тексты требуют токенов
        tokensSaved: cacheHits // Количество сэкономленных запросов
      }
    });
    
  } catch (error) {
    console.error('Translation error:', error);
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'Сервис Claude временно недоступен. Попробуйте позже.' 
      });
    }
    
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

// Функция генерации ключа кеша
function generateCacheKey(text, fromLang, toLang, context, customPrompt) {
  const data = `${text}|${fromLang}|${toLang}|${context}|${customPrompt}`;
  return createHash('sha256').update(data).digest('hex').substring(0, 16);
}

// Функция проверки истечения кеша
function isCacheExpired(timestamp) {
  return Date.now() - timestamp > CACHE_TTL;
}

// Функция очистки устаревшего кеша
function cleanExpiredCache() {
  const now = Date.now();
  const keysToDelete = [];
  
  for (const [key, value] of translationCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => translationCache.delete(key));
  
  if (keysToDelete.length > 0) {
    console.log(`Cleaned ${keysToDelete.length} expired cache entries`);
  }
}
