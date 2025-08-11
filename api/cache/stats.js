// api/cache/stats.js - расширенная диагностика Redis
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
    
    console.log('=== Redis Configuration Check ===');
    console.log('URL exists:', !!redisUrl);
    console.log('URL value:', redisUrl);
    console.log('Token exists:', !!redisToken);
    console.log('Token length:', redisToken ? redisToken.length : 0);
    console.log('Token start:', redisToken ? redisToken.substring(0, 10) + '...' : 'none');
    
    if (!redisUrl || !redisToken) {
      return res.json({
        error: 'Missing environment variables',
        debug: {
          hasUrl: !!redisUrl,
          hasToken: !!redisToken,
          url: redisUrl || 'missing',
          tokenLength: redisToken ? redisToken.length : 0
        }
      });
    }
    
    // Тест 1: Импорт библиотеки
    console.log('=== Testing Redis Import ===');
    let Redis;
    try {
      const module = await import('@upstash/redis');
      Redis = module.Redis;
      console.log('✅ Redis imported successfully');
    } catch (importError) {
      console.error('❌ Redis import failed:', importError);
      return res.json({
        error: 'Redis import failed',
        importError: importError.message,
        step: 'import'
      });
    }
    
    // Тест 2: Создание клиента через fromEnv
    console.log('=== Testing Redis.fromEnv() ===');
    let redis;
    try {
      redis = Redis.fromEnv();
      console.log('✅ Redis client created via fromEnv()');
    } catch (envError) {
      console.error('❌ Redis.fromEnv() failed:', envError);
      
      // Тест 3: Создание клиента вручную
      console.log('=== Testing manual Redis client ===');
      try {
        redis = new Redis({
          url: redisUrl,
          token: redisToken,
        });
        console.log('✅ Redis client created manually');
      } catch (manualError) {
        console.error('❌ Manual Redis client failed:', manualError);
        return res.json({
          error: 'Failed to create Redis client',
          envError: envError.message,
          manualError: manualError.message,
          step: 'client_creation'
        });
      }
    }
    
    // Тест 4: Простейший запрос
    console.log('=== Testing Redis Connection ===');
    try {
      const pingResult = await redis.ping();
      console.log('✅ Redis ping successful:', pingResult);
    } catch (pingError) {
      console.error('❌ Redis ping failed:', pingError);
      return res.json({
        error: 'Redis ping failed',
        pingError: pingError.message,
        errorType: pingError.name,
        step: 'ping'
      });
    }
    
    // Тест 5: Получение размера базы
    console.log('=== Testing Redis Operations ===');
    try {
      const dbsize = await redis.dbsize();
      console.log('✅ Redis dbsize successful:', dbsize);
      
      return res.json({
        success: true,
        totalEntries: dbsize,
        cacheType: 'Redis (Upstash)',
        status: 'connected',
        debug: {
          url: redisUrl,
          tokenLength: redisToken.length,
          pingResult: 'PONG',
          dbsize: dbsize
        }
      });
      
    } catch (dbError) {
      console.error('❌ Redis dbsize failed:', dbError);
      return res.json({
        error: 'Redis operation failed',
        dbError: dbError.message,
        errorType: dbError.name,
        step: 'dbsize'
      });
    }
    
  } catch (error) {
    console.error('=== General Error ===', error);
    return res.status(500).json({ 
      error: 'Unexpected error',
      message: error.message,
      type: error.name,
      stack: error.stack?.split('\n').slice(0, 5)
    });
  }
}
