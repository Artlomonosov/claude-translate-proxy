// api/cache/stats.js - прямые HTTP запросы к Redis без библиотеки
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
    
    console.log('=== Direct HTTP Redis Test ===');
    console.log('URL:', redisUrl);
    console.log('Token length:', redisToken ? redisToken.length : 0);
    
    if (!redisUrl || !redisToken) {
      return res.json({
        error: 'Missing Redis credentials',
        hasUrl: !!redisUrl,
        hasToken: !!redisToken
      });
    }
    
    // Тест 1: Прямой HTTP ping
    console.log('Testing direct HTTP ping...');
    try {
      const pingResponse = await fetch(`${redisUrl}/ping`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${redisToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Ping response status:', pingResponse.status);
      const pingData = await pingResponse.text();
      console.log('Ping response data:', pingData);
      
      if (!pingResponse.ok) {
        return res.json({
          error: 'Redis HTTP ping failed',
          status: pingResponse.status,
          response: pingData,
          step: 'http_ping'
        });
      }
      
    } catch (pingError) {
      console.error('Ping fetch error:', pingError);
      return res.json({
        error: 'Ping fetch failed',
        message: pingError.message,
        type: pingError.name,
        step: 'ping_fetch'
      });
    }
    
    // Тест 2: Получение размера базы данных
    console.log('Testing dbsize...');
    try {
      const dbsizeResponse = await fetch(`${redisUrl}/dbsize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${redisToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Dbsize response status:', dbsizeResponse.status);
      const dbsizeData = await dbsizeResponse.json();
      console.log('Dbsize response data:', dbsizeData);
      
      if (!dbsizeResponse.ok) {
        return res.json({
          error: 'Redis dbsize HTTP failed',
          status: dbsizeResponse.status,
          response: dbsizeData,
          step: 'http_dbsize'
        });
      }
      
      // Успех!
      return res.json({
        success: true,
        totalEntries: dbsizeData.result || 0,
        memoryUsage: 0,
        hitsToday: 0,
        tokensSaved: (dbsizeData.result || 0) * 3,
        topTranslations: [],
        cacheType: 'Redis (Direct HTTP)',
        status: 'connected',
        debug: {
          pingWorked: true,
          dbsize: dbsizeData.result,
          httpMethod: 'direct'
        }
      });
      
    } catch (dbsizeError) {
      console.error('Dbsize fetch error:', dbsizeError);
      return res.json({
        error: 'Dbsize fetch failed',
        message: dbsizeError.message,
        type: dbsizeError.name,
        step: 'dbsize_fetch'
      });
    }
    
  } catch (error) {
    console.error('=== General Error ===', error);
    return res.status(500).json({ 
      error: 'Unexpected error',
      message: error.message,
      type: error.name,
      step: 'general'
    });
  }
}
