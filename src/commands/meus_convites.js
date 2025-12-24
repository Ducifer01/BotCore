const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPrisma } = require('../db');
const { ensurePointsConfig, getPointsConfig } = require('../services/points');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meus_convites')
    .setDescription('Mostra o status dos convites que você fez'),
  async execute(interaction) {
    const prisma = getPrisma();
    await ensurePointsConfig(prisma);
    const cfg = await getPointsConfig(prisma);
    if (!cfg?.enabled) {
      return interaction.reply({ content: 'Sistema de pontos está desativado.', ephemeral: true });
    }

    const tempoServerHours = cfg.tempoServerHours || 24;
    const diasConvite = cfg.diasConvite || 0;
    const idadeContaDias = cfg.idadeContaDias || 0;
    const now = Date.now();

    const statusLabel = {
      PENDING: 'PENDENTE',
      CONFIRMED: 'CONFIRMADO',
      REVOKED: 'REVOGADO',
    };

    const revokedMap = {
      IDADE_MINIMA: 'revogado: idade da conta abaixo do mínimo',
      SAIU_ANTES_CONFIRMACAO: 'revogado: saiu antes do tempo mínimo de servidor',
      SAIU_ANTES_PRAZO: 'revogado: saiu antes do prazo pós-confirmação',
    };
    const inviteeEntries = await prisma.pointsInviteLedger.findMany({
      where: { globalConfigId: cfg.globalConfigId || cfg.id, inviterId: interaction.user.id },
      orderBy: { invitedAt: 'desc' },
      take: 25,
    });

    if (!inviteeEntries.length) {
      return interaction.reply({ content: 'Você ainda não possui convites registrados.', ephemeral: true });
    }

    const lines = inviteeEntries.map((entry) => {
      const name = entry.inviteeId;
      const invitedAt = entry.invitedAt ? new Date(entry.invitedAt).getTime() : null;
      const confirmAt = entry.confirmedAt ? new Date(entry.confirmedAt).getTime() : null;
      const status = entry.status;
      let reason = '';
      if (status === 'PENDING') {
        const cutoff = invitedAt ? invitedAt + tempoServerHours * 60 * 60 * 1000 : null;
        if (cutoff && cutoff > now) {
          reason = `aguardando ${Math.ceil((cutoff - now) / 3600000)}h para confirmar`;
        } else {
          reason = 'aguardando confirmação';
        }
      }
      if (status === 'CONFIRMED') {
        const limit = confirmAt && diasConvite > 0 ? confirmAt + diasConvite * 24 * 3600000 : null;
        reason = limit ? `confirmado; estorno só se sair antes de <t:${Math.floor(limit / 1000)}:R>` : 'confirmado';
      }
      if (status === 'REVOKED') {
        reason = revokedMap[entry.revokedReason] || 'revogado';
      }
      const whenInvited = invitedAt ? `<t:${Math.floor(invitedAt / 1000)}:R>` : 'tempo indisp.';
      const label = statusLabel[status] || status;
      return `• <@${name}> — **${label}** (${reason || '—'}) — convidado ${whenInvited}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Seus convites')
      .setColor(0x2ecc71)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Regras: tempo servidor ${tempoServerHours}h | estorno se sair antes de ${diasConvite}d | idade mínima ${idadeContaDias}d | paga 1x por usuário.` })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
