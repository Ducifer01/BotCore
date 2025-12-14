const REQUIRED_INSTA_FIELDS = [
  { key: 'instaBoysChannelId', label: 'o canal Insta Boys' },
  { key: 'instaGirlsChannelId', label: 'o canal Insta Girls' },
  { key: 'photosMaleChannelId', label: 'o canal de fotos masculino' },
  { key: 'photosFemaleChannelId', label: 'o canal de fotos feminino' },
  { key: 'mainRoleId', label: 'o cargo InstaMod' },
  { key: 'verifiedRoleId', label: 'o cargo verificado' },
  { key: 'verifyPanelChannelId', label: 'o painel verifique-se' },
];

function requireInstaConfig(cfg) {
  const missing = REQUIRED_INSTA_FIELDS.find((field) => {
    const value = cfg?.[field.key];
    return !value || (typeof value === 'string' && !value.trim());
  });
  if (missing) {
    return {
      ok: false,
      missing: missing.key,
      message: `Você precisa configurar ${missing.label}.`,
    };
  }
  return { ok: true };
}

module.exports = {
  requireInstaConfig,
  REQUIRED_INSTA_FIELDS,
};
