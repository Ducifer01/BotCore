const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const {
  getPointsConfig,
  ensurePointsConfig,
  ensureBalance,
  toBigInt,
  userEligible,
  isVoiceChannelAllowed,
} = require('../services/points');

function formatSeconds(total) {
  const sec = Math.max(0, Math.trunc(total || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pontos')
    .setDescription('Mostra seus pontos ou de outro usuário')
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário alvo').setRequired(false)),
  async execute(interaction) {
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const balance = await ensureBalance(prisma, cfg, interaction.guildId, targetUser.id);
    const pts = toBigInt(balance.points || 0n);

    let callInfo = 'Não está em call.';
    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const voice = member?.voice;
      const channel = voice?.channel || null;
      if (channel) {
        const hasVoiceFilters = (cfg.voiceChannels?.length || cfg.voiceCategories?.length);
        const allowedVoice = isVoiceChannelAllowed(cfg, channel);
        if (hasVoiceFilters && !allowedVoice) {
          callInfo = [
            `Canal: ${channel.name}`,
            'Status: Não elegível (este canal/categoria não pontua)',
            'Próximo ganho: —',
          ].join('\n');
          const embed = new EmbedBuilder()
            .setTitle('Seus pontos')
            .setColor(0x00b0f4)
            .setDescription(`${targetUser.id === interaction.user.id ? 'Você tem' : `${targetUser} tem`} **${pts}** pontos.`)
            .addFields({ name: 'Call', value: callInfo })
            .setTimestamp(new Date());
          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }
        const muted = voice.selfMute || voice.serverMute;
        const deaf = voice.selfDeaf || voice.serverDeaf;
        const minUsers = cfg.minUserCall || 0;
        const tempoCallMinutes = cfg.tempoCallMinutes || 5;
        const blockSeconds = Math.max(1, tempoCallMinutes * 60);
        const participants = [...channel.members.values()].filter((m) => {
          if (m.user.bot) return false;
          if (!userEligible(cfg, m)) return false;
          if (m.voice?.selfMute || m.voice?.serverMute) return false;
          if (m.voice?.selfDeaf || m.voice?.serverDeaf) return false;
          return true;
        });
        const participantCount = participants.length;
        const eligibleBase = userEligible(cfg, member) && !muted && !deaf;
        const meetsMin = participantCount >= minUsers;
        const eligible = eligibleBase && meetsMin;
        const globalConfigId = cfg.globalConfigId || cfg.id;
        const session = await prisma.pointsVoiceSession.findUnique({ where: { globalConfigId_guildId_userId: { globalConfigId, guildId: interaction.guildId, userId: targetUser.id } } });
        const remainder = blockSeconds - (session?.accumulatedSeconds || 0);
        const timeRemaining = remainder <= 0 ? blockSeconds : remainder;
        const nextAward = cfg.pontosCall || 0;
        const ts = Math.floor((Date.now() + timeRemaining * 1000) / 1000);
        callInfo = [
          `Canal: ${channel.name}`,
          `Status: ${eligible ? 'Elegível' : 'Não elegível'}${muted ? ' (mutado)' : ''}${deaf ? ' (deafen)' : ''}`,
          `Participantes ativos: ${participantCount}/${minUsers}`,
          eligible ? `Próximo ganho: +${nextAward} pts <t:${ts}:R>` : 'Próximo ganho: —',
        ].join('\n');
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Seus pontos')
      .setColor(0x00b0f4)
      .setDescription(`${targetUser.id === interaction.user.id ? 'Você tem' : `${targetUser} tem`} **${pts}** pontos.`)
      .addFields({ name: 'Call', value: callInfo })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
