// api/cache/clear.js - очистка Redis кеша через HTTP
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
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    console.log('Clearing Redis cache...');
    console.log('Redis URL exists:', !!redisUrl);
    console.log('Redis Token exists:', !!redisToken);
    
    if (!redisUrl || !redisToken) {
      return res.json({
        error: 'Redis credentials not configured',
        deletedEntries: 0
      });
    }
    
    // Сначала получаем количество ключей
    let keyCount = 0;
    try {
      const dbsizeResponse = await fetch(`${redisUrl}/dbsize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${redisToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (dbsizeResponse.ok) {
        const dbsizeData = await dbsizeResponse.json();
        keyCount = dbsizeData.result || 0;
        console.log('Keys before clearing:', keyCount);
      }
    } catch (error) {
      console.warn('Could not get dbsize:', error.message);
    }
    
    // Очищаем всю базу данных
    const flushResponse = await fetch(`${redisUrl}/flushdb`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Flush response status:', flushResponse.status);
    
    if (!flushResponse.ok) {
      const errorText = await flushResponse.text();
      console.error('Flush failed:', errorText);
      return res.status(flushResponse.status).json({
        error: 'Failed to clear Redis cache',
        details: errorText
      });
    }
    
    const flushData = await flushResponse.json();
    console.log('Flush response:', flushData);
    
    // Проверяем результат
    const success = flushData.result === 'OK';
    
    res.json({ 
      success: success,
      deletedEntries: keyCount,
      message: success ? 
        `Successfully cleared ${keyCount} cache entries` : 
        'Cache clear operation completed'
    });
    
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({ 
      error: 'Failed to clear Redis cache',
      message: error.message,
      type: error.name
    });
  }
}
