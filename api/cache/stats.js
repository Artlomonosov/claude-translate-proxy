// api/cache/stats.js - получение статистики кеша из Redis
import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const redis = Redis.fromEnv();
    
    // Получаем информацию о базе данных
    const info = await redis.info();
    const dbsize = await redis.dbsize();
    
    // Парсим информацию Redis
    const memoryUsage = extractInfoValue(info, 'used_memory');
    const totalCommands = extractInfoValue(info, 'total_commands_processed');
    
    // Получаем примеры ключей (первые 10)
    const keys = await redis.keys('*');
    const sampleKeys = keys.slice(0, 10);
    
    const topTranslations = [];
    for (const key of sampleKeys) {
      try {
        const value = await redis.get(key);
        if (value) {
          // Показываем первые 20 символов ключа и полный перевод
          topTranslations.push({
            original: key.substring(0, 8) + '...',
            translation: typeof value === 'string' ? value : JSON.stringify(value),
            hits: 1 // Redis не ведет счетчик обращений автоматически
          });
        }
      } catch (error) {
        console.warn('Error reading key:', key, error);
      }
    }
    
    const stats = {
      totalEntries: dbsize,
      memoryUsage: parseInt(memoryUsage) || 0,
      hitsToday: parseInt(totalCommands) || 0,
      tokensSaved: dbsize * 5, // Примерная оценка
      topTranslations: topTranslations,
      cacheType: 'Redis (Upstash)',
      status: 'connected'
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Redis stats error:', error);
    
    // Fallback если Redis недоступен
    res.json({
      totalEntries: 0,
      memoryUsage: 0,
      hitsToday: 0,
      tokensSaved: 0,
      topTranslations: [],
      cacheType: 'Redis (disconnected)',
      status: 'disconnected',
      error: 'Redis connection failed'
    });
  }
}

function extractInfoValue(info, key) {
  const lines = info.split('\n');
  for (const line of lines) {
    if (line.startsWith(key + ':')) {
      return line.split(':')[1]?.trim();
    }
  }
  return '0';
}

// api/cache/clear.js - очистка Redis кеша
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const redis = Redis.fromEnv();
    
    // Получаем количество ключей перед очисткой
    const keysCount = await redis.dbsize();
    
    // Очищаем всю базу данных
    await redis.flushdb();
    
    res.json({ 
      success: true, 
      deletedEntries: keysCount,
      message: `Cleared ${keysCount} cache entries from Redis`
    });
  } catch (error) {
    console.error('Redis clear error:', error);
    res.status(500).json({ 
      error: 'Failed to clear Redis cache: ' + error.message 
    });
  }
}

// api/cache/export.js - экспорт Redis кеша
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const redis = Redis.fromEnv();
    
    // Получаем все ключи
    const keys = await redis.keys('*');
    
    // Ограничиваем экспорт для производительности
    const maxKeys = Math.min(keys.length, 10000);
    const keysToExport = keys.slice(0, maxKeys);
    
    const entries = {};
    
    // Получаем значения для каждого ключа
    for (const key of keysToExport) {
      try {
        const value = await redis.get(key);
        const ttl = await redis.ttl(key);
        
        entries[key] = {
          translation: value,
          timestamp: Date.now(),
          ttl: ttl > 0 ? ttl : null
        };
      } catch (error) {
        console.warn('Error exporting key:', key, error);
      }
    }
    
    const cacheData = {
      version: '1.1',
      exported: new Date().toISOString(),
      cacheType: 'Redis',
      totalKeys: keys.length,
      exportedKeys: keysToExport.length,
      entries: entries
    };
    
    res.json(cacheData);
  } catch (error) {
    console.error('Redis export error:', error);
    res.status(500).json({ 
      error: 'Failed to export Redis cache: ' + error.message 
    });
  }
}

// api/cache/import.js - импорт в Redis кеш
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const redis = Redis.fromEnv();
    const { entries } = req.body;
    
    if (!entries || typeof entries !== 'object') {
      return res.status(400).json({ error: 'Invalid cache data format' });
    }
    
    let importedEntries = 0;
    let errors = 0;
    
    const defaultTTL = 24 * 60 * 60; // 24 часа
    
    for (const [key, value] of Object.entries(entries)) {
      try {
        let translation;
        let ttl = defaultTTL;
        
        if (typeof value === 'string') {
          translation = value;
        } else if (value && typeof value.translation === 'string') {
          translation = value.translation;
          ttl = value.ttl || defaultTTL;
        } else {
          continue; // Пропускаем невалидные записи
        }
        
        // Импортируем с TTL
        await redis.setex(key, ttl, translation);
        importedEntries++;
        
      } catch (error) {
        console.warn('Error importing key:', key, error);
        errors++;
      }
    }
    
    res.json({ 
      success: true, 
      importedEntries: importedEntries,
      errors: errors,
      message: `Imported ${importedEntries} entries to Redis cache`
    });
  } catch (error) {
    console.error('Redis import error:', error);
    res.status(500).json({ 
      error: 'Failed to import to Redis cache: ' + error.message 
    });
  }
}
