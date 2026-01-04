const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const profileCache = new Map(); // cacheKey -> { at, ttl, result }

function normalize(str) {
  return (str || '').toString().trim();
}

function toLower(str) {
  return normalize(str).toLowerCase();
}

function keywordMatch(keyword, { bio, pronouns, globalName }) {
  const key = toLower(keyword);
  if (!key) return false;
  return [bio, pronouns, globalName].some((field) => toLower(field || '').includes(key));
}

function isActive(cfg) {
  if (!cfg) return false;
  if (!cfg.enabled) return false;
  if (!normalize(cfg.keyword)) return false;
  if (!normalize(cfg.selfToken)) return false;
  return true;
}

async function ensureBioCheckerConfig(prisma, pointsConfigId) {
  if (!pointsConfigId) return null;
  const existing = await prisma.pointsBioCheckerConfig.findUnique({ where: { pointsConfigId } });
  if (existing) return existing;
  return prisma.pointsBioCheckerConfig.create({
    data: {
      pointsConfigId,
      enabled: false,
      keyword: null,
      selfToken: null,
      strictMode: true,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    },
  });
}

async function getBioCheckerConfig(prisma, pointsConfigId) {
  if (!pointsConfigId) return null;
  const cfg = await prisma.pointsBioCheckerConfig.findUnique({ where: { pointsConfigId } });
  if (cfg) return cfg;
  return ensureBioCheckerConfig(prisma, pointsConfigId);
}

async function fetchProfile({ token, userId }) {
  const url = `https://discord.com/api/v9/users/${userId}/profile`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'User-Agent': 'BioChecker/1.0 (+https://discord.com)',
    },
  });
  const status = res.status;
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  return { status, data };
}

function extractFields(data) {
  if (!data) return { bio: '', pronouns: '', globalName: '' };
  const user = data.user || {};
  const profile = data.user_profile || data.profile || {};
  return {
    bio: data.bio || user.bio || profile.bio || '',
    pronouns: data.pronouns || user.pronouns || profile.pronouns || '',
    globalName: user.global_name || user.globalName || profile.global_name || profile.globalName || '',
  };
}

async function updateStatus(prisma, cfg, { success, error }) {
  if (!cfg?.id) return;
  const data = success
    ? { lastSuccessAt: new Date(), lastError: null }
    : { lastError: error || 'erro desconhecido' };
  await prisma.pointsBioCheckerConfig.update({ where: { id: cfg.id }, data }).catch(() => {});
}

async function checkUserKeyword({ prisma, pointsCfg, userId, forceRefresh = false }) {
  if (!pointsCfg) return { allowed: true, active: false };
  const bioCfg = await getBioCheckerConfig(prisma, pointsCfg.id);
  if (!bioCfg) return { allowed: true, active: false };
  const active = isActive(bioCfg);
  if (!active) {
    return { allowed: true, active: false, keyword: bioCfg.keyword || null, strictMode: bioCfg.strictMode !== false };
  }

  const ttl = bioCfg.cacheTtlMs || DEFAULT_CACHE_TTL_MS;
  const keyword = normalize(bioCfg.keyword);
  const cacheKey = `${userId}:${keyword}`;
  const cached = !forceRefresh ? profileCache.get(cacheKey) : null;
  const now = Date.now();
  if (cached && now - cached.at < ttl) {
    return { ...cached.result, fromCache: true, keyword: bioCfg.keyword };
  }

  const token = normalize(bioCfg.selfToken);
  if (!token) {
    const result = { allowed: false, active: true, keyword: bioCfg.keyword, reason: 'missing_token', strictMode: bioCfg.strictMode !== false };
    profileCache.set(cacheKey, { at: now, ttl, result });
    await updateStatus(prisma, bioCfg, { success: false, error: 'Token não configurado' });
    return result;
  }

  if (!keyword) {
    const result = { allowed: false, active: true, keyword: null, reason: 'missing_keyword', strictMode: bioCfg.strictMode !== false };
    profileCache.set(cacheKey, { at: now, ttl, result });
    await updateStatus(prisma, bioCfg, { success: false, error: 'Palavra-chave não configurada' });
    return result;
  }

  try {
    const { status, data } = await fetchProfile({ token, userId });
    if (status !== 200) {
      const allowed = bioCfg.strictMode === false;
      const result = {
        allowed,
        active: true,
        keyword,
        reason: 'request_error',
        status,
        strictMode: bioCfg.strictMode !== false,
      };
      profileCache.set(cacheKey, { at: now, ttl, result });
      await updateStatus(prisma, bioCfg, { success: allowed, error: `HTTP ${status}` });
      return result;
    }
    const fields = extractFields(data);
    const hasKeyword = keywordMatch(keyword, fields);
    const result = {
      allowed: hasKeyword,
      active: true,
      keyword,
      reason: hasKeyword ? null : 'missing_keyword_profile',
      fields,
      strictMode: bioCfg.strictMode !== false,
    };
    profileCache.set(cacheKey, { at: now, ttl, result });
    await updateStatus(prisma, bioCfg, { success: true });
    return result;
  } catch (err) {
    const allowed = bioCfg.strictMode === false;
    const result = {
      allowed,
      active: true,
      keyword,
      reason: 'exception',
      error: err?.message || String(err),
      strictMode: bioCfg.strictMode !== false,
    };
    profileCache.set(cacheKey, { at: now, ttl, result });
    await updateStatus(prisma, bioCfg, { success: allowed, error: result.error });
    return result;
  }
}

async function testToken({ prisma, pointsCfg, userId }) {
  const bioCfg = await getBioCheckerConfig(prisma, pointsCfg.id);
  if (!bioCfg) return { ok: false, message: 'Config não encontrada.' };
  if (!normalize(bioCfg.selfToken)) return { ok: false, message: 'Token não configurado.' };
  const token = normalize(bioCfg.selfToken);
  try {
    const { status, data } = await fetchProfile({ token, userId });
    if (status !== 200) {
      await updateStatus(prisma, bioCfg, { success: false, error: `HTTP ${status}` });
      return { ok: false, status, message: `Falha ao consultar perfil (HTTP ${status}).` };
    }
    const fields = extractFields(data);
    const keyword = normalize(bioCfg.keyword);
    const hasKeyword = keyword ? keywordMatch(keyword, fields) : false;
    await updateStatus(prisma, bioCfg, { success: true });
    return { ok: true, status, fields, hasKeyword, keyword };
  } catch (err) {
    await updateStatus(prisma, bioCfg, { success: false, error: err?.message || String(err) });
    return { ok: false, message: err?.message || 'Erro inesperado' };
  }
}

function clearCacheForUser(userId) {
  profileCache.delete(userId);
}

function clearCacheAll() {
  profileCache.clear();
}

module.exports = {
  ensureBioCheckerConfig,
  getBioCheckerConfig,
  checkUserKeyword,
  testToken,
  isActive,
  clearCacheForUser,
  clearCacheAll,
};
