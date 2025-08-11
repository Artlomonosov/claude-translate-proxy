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
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!redisUrl || !redisToken) {
      return res.json({
        error: 'Redis not configured',
        version: '1.1',
        exported: new Date().toISOString(),
        entries: {}
      });
    }
    
    // Получаем все ключи
    const keysResponse = await fetch(`${redisUrl}/keys/*`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!keysResponse.ok) {
      throw new Error(`Failed to get keys: ${keysResponse.status}`);
    }
    
    const keysData = await keysResponse.json();
    const keys = keysData.result || [];
    
    console.log('Found', keys.length, 'keys to export');
    
    // Ограничиваем количество ключей для экспорта
    const maxKeys = Math.min(keys.length, 1000);
    const keysToExport = keys.slice(0, maxKeys);
    
    const entries = {};
    
    // Получаем значения для каждого ключа
    for (const key of keysToExport) {
      try {
        const valueResponse = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${redisToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (valueResponse.ok) {
          const valueData = await valueResponse.json();
          let value = valueData.result;
          
          // Убираем лишние кавычки если есть
          if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          }
          
          entries[key] = {
            translation: value,
            timestamp: Date.now()
          };
        }
      } catch (error) {
        console.warn('Error exporting key:', key, error.message);
      }
    }
    
    const cacheData = {
      version: '1.1',
      exported: new Date().toISOString(),
      cacheType: 'Redis HTTP',
      totalKeys: keys.length,
      exportedKeys: Object.keys(entries).length,
      entries: entries
    };
    
    res.json(cacheData);
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ 
      error: 'Failed to export cache',
      message: error.message
    });
  }
}
