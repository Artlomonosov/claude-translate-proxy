// api/cache/stats.js - ТОЛЬКО для статистики кеша
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
    // Проверяем наличие переменных Redis
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    console.log('Checking Redis config...');
    console.log('URL exists:', !!redisUrl);
    console.log('Token exists:', !!redisToken);
    console.log('URL preview:', redisUrl ? redisUrl.substring(0, 30) + '...' : 'not set');
    console.log('Token length:', redisToken ? redisToken.length : 0);
    
    if (!redisUrl || !redisToken) {
      return res.json({
        error: 'Redis environment variables missing',
        hasUrl: !!redisUrl,
        hasToken: !!redisToken,
        totalEntries: 0,
        cacheType: 'Redis (not configured)',
        status: 'env_missing'
      });
    }
    
    // Пробуем импортировать и подключиться к Redis
    try {
      const { Redis } = await import('@upstash/redis');
      const redis = Redis.fromEnv();
      
      console.log('Redis client created, testing connection...');
      
      // Тестируем подключение
      const dbsize = await redis.dbsize();
      console.log('Redis connected successfully, dbsize:', dbsize);
      
      // Получаем примеры ключей
      const keys = await redis.keys('*');
      const sampleKeys = keys.slice(0, 5);
      
      console.log('Found keys:', sampleKeys.length);
      
      const topTranslations = [];
      for (const key of sampleKeys) {
        try {
          const value = await redis.get(key);
          if (value) {
            topTranslations.push({
              original: key.substring(0, 8) + '...',
              translation: typeof value === 'string' ? value.substring(0, 50) : 'complex_value',
              hits: 1
            });
          }
        } catch (keyError) {
          console.warn('Error reading key:', key, keyError.message);
        }
      }
      
      return res.json({
        totalEntries: dbsize,
        memoryUsage: keys.length * 100, // Примерная оценка
        hitsToday: dbsize,
        tokensSaved: dbsize * 3,
        topTranslations: topTranslations,
        cacheType: 'Redis (Upstash)',
        status: 'connected',
        debug: {
          totalKeys: keys.length,
          sampleKeysCount: sampleKeys.length
        }
      });
      
    } catch (redisError) {
      console.error('Redis error:', redisError);
      
      return res.json({
        error: 'Redis operation failed',
        errorType: redisError.name || 'Unknown',
        errorMessage: redisError.message || 'Unknown error',
        totalEntries: 0,
        cacheType: 'Redis (connection failed)',
        status: 'redis_error'
      });
    }
    
  } catch (error) {
    console.error('General error in stats:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      type: error.name || 'Unknown'
    });
  }
}
