// api/translate.js - версия с прямыми HTTP запросами к Redis
import { createHash } from 'crypto';

// Настройки кеша
const CACHE_TTL = 24 * 60 * 60; // 24 часа в секундах

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
      useCache = true
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
    
    // Получаем настройки Redis
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const redisAvailable = !!(redisUrl && redisToken);
    
    console.log('Redis available:', redisAvailable, 'Cache enabled:', useCache);
    
    // Кеширование переводов
    let cacheHits = 0;
    let cacheMisses = 0;
    const cachedTranslations = [];
    const textsToTranslate = [];
    const textIndexMapping = [];
    
    if (useCache && redisAvailable) {
      console.log('Using Redis cache for', texts.length, 'texts');
      
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const cacheKey = generateCacheKey(text, fromLang, toLang, contextText, customPrompt);
        
        let cachedResult = null;
        
        try {
          // Получаем из Redis через HTTP
          cachedResult = await getFromRedisCache(redisUrl, redisToken, cacheKey);
        } catch (error) {
          console.warn('Cache read error for key', cacheKey, ':', error.message);
          cachedResult = null;
        }
        
        if (cachedResult) {
          // Найдено в кеше
          cachedTranslations[i] = cachedResult;
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
      // Кеш отключен или недоступен, переводим все
      console.log('Cache disabled or unavailable, translating all texts');
      textsToTranslate.push(...texts);
      textIndexMapping.push(...texts.map((_, i) => i));
      cacheMisses = texts.length;
    }
    
    let newTranslations = [];
    
    // Переводим только те тексты, которых нет в кеше
    if (textsToTranslate.length > 0) {
      console.log('Translating', textsToTranslate.length, 'texts with Claude');
      
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
      if (useCache && redisAvailable) {
        console.log('Saving', newTranslations.length, 'translations to Redis cache');
        
        for (let i = 0; i < textsToTranslate.length; i++) {
          const text = textsToTranslate[i];
          const translation = newTranslations[i];
          const cacheKey = generateCacheKey(text, fromLang, toLang, contextText, customPrompt);
          
          try {
            await saveToRedisCache(redisUrl, redisToken, cacheKey, translation, CACHE_TTL);
          } catch (error) {
            console.warn('Cache write error for key', cacheKey, ':', error.message);
          }
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
    console.log('Translation completed:', {
      textsCount: texts.length,
      model: model,
      hasGlossary: hasGlossary,
      hasCustomPrompt: hasCustomPrompt,
      translationsCount: finalTranslations.length,
      cacheHits: cacheHits,
      cacheMisses: cacheMisses,
      cacheType: redisAvailable ? 'Redis HTTP' : 'disabled'
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
        tokensRequired: cacheMisses,
        tokensSaved: cacheHits,
        cacheType: redisAvailable ? 'Redis HTTP' : 'disabled'
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

// Функция получения из Redis кеша через HTTP
async function getFromRedisCache(redisUrl, redisToken, key) {
  try {
    const response = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return null; // Ключ не найден
      }
      throw new Error(`Redis GET failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Проверяем, что result существует и не null
    if (data.result === null || data.result === undefined) {
      return null;
    }
    
    // Если результат - строка в кавычках, убираем их
    let result = data.result;
    if (typeof result === 'string' && result.startsWith('"') && result.endsWith('"')) {
      result = result.slice(1, -1);
    }
    
    return result;
  } catch (error) {
    console.warn('Redis GET error:', error);
    return null;
  }
}

// Функция сохранения в Redis кеш через HTTP
async function saveToRedisCache(redisUrl, redisToken, key, value, ttl) {
  try {
    const response = await fetch(`${redisUrl}/setex/${encodeURIComponent(key)}/${ttl}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${redisToken}`,
        'Content-Type': 'text/plain'
      },
      body: value // Отправляем как обычную строку, не JSON
    });
    
    if (!response.ok) {
      throw new Error(`Redis SETEX failed: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.warn('Redis SETEX error:', error);
    return false;
  }
}
