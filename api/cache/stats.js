// api/cache/stats.js - получение статистики кеша
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
    // Импортируем кеш из основного модуля
    const { translationCache } = await import('../translate.js');
    
    const stats = {
      totalEntries: translationCache.size,
      memoryUsage: JSON.stringify([...translationCache.entries()]).length,
      hitsToday: 0, // Можно добавить счетчик в будущем
      tokensSaved: 0, // Можно вычислить на основе истории
      topTranslations: []
    };
    
    // Собираем топ переводов (упрощенная версия)
    const translations = [];
    for (const [key, value] of translationCache.entries()) {
      // Декодируем ключ обратно для отображения (упрощенно)
      translations.push({
        original: key.substring(0, 8) + '...', // Показываем часть хеша
        translation: value.translation,
        hits: 1 // В реальности нужно вести счетчик
      });
    }
    
    stats.topTranslations = translations.slice(0, 10);
    
    res.json(stats);
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
}

// api/cache/clear.js - очистка кеша
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
    const { translationCache } = await import('../translate.js');
    
    const deletedEntries = translationCache.size;
    translationCache.clear();
    
    res.json({ 
      success: true, 
      deletedEntries: deletedEntries,
      message: `Cleared ${deletedEntries} cache entries`
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
}

// api/cache/export.js - экспорт кеша
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
    const { translationCache } = await import('../translate.js');
    
    const cacheData = {
      version: '1.0',
      exported: new Date().toISOString(),
      entries: Object.fromEntries(translationCache)
    };
    
    res.json(cacheData);
  } catch (error) {
    console.error('Cache export error:', error);
    res.status(500).json({ error: 'Failed to export cache' });
  }
}

// api/cache/import.js - импорт кеша
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
    const { translationCache } = await import('../translate.js');
    const { entries } = req.body;
    
    if (!entries || typeof entries !== 'object') {
      return res.status(400).json({ error: 'Invalid cache data format' });
    }
    
    let importedEntries = 0;
    
    for (const [key, value] of Object.entries(entries)) {
      // Валидируем структуру данных
      if (value && typeof value.translation === 'string' && typeof value.timestamp === 'number') {
        translationCache.set(key, value);
        importedEntries++;
      }
    }
    
    res.json({ 
      success: true, 
      importedEntries: importedEntries,
      message: `Imported ${importedEntries} cache entries`
    });
  } catch (error) {
    console.error('Cache import error:', error);
    res.status(500).json({ error: 'Failed to import cache' });
  }
}
