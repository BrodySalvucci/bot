const fs = require('fs');
const path = require('path');
const marked = require('marked');
const Mustache = require('mustache');
const Cryptr = require('cryptr');
const { decrypt } = new Cryptr(process.env.ENCRYPTION_KEY);

module.exports.get = fastify => ({
	handler: async (req, res) => {
		/** @type {import('client')} */
		const client = req.routeOptions.config.client;
		const ticketId = req.params.id;

		try {
			const ticket = await client.prisma.ticket.findUnique({
				include: {
					category: true,
					createdBy: true,
					closedBy: true,
					claimedBy: true,
					feedback: true,
					archivedMessages: {
						include: {
							author: true
						},
						orderBy: { createdAt: 'asc' }
					}
				},
				where: { id: ticketId },
			});

			if (!ticket) {
				return res.code(404).send({
					error: 'Not Found',
					message: 'The requested transcript could not be found.',
					statusCode: 404,
				});
			}

			// Decrypt ticket metadata
			if (ticket.closedReason) ticket.closedReason = decrypt(ticket.closedReason);
			if (ticket.feedback?.comment) ticket.feedback.comment = decrypt(ticket.feedback.comment);
			if (ticket.topic) ticket.topic = decrypt(ticket.topic);

			// Decrypt user information
			if (ticket.createdBy?.username) ticket.createdBy.username = decrypt(ticket.createdBy.username);
			if (ticket.createdBy?.displayName) ticket.createdBy.displayName = decrypt(ticket.createdBy.displayName);
			if (ticket.closedBy?.username) ticket.closedBy.username = decrypt(ticket.closedBy.username);
			if (ticket.closedBy?.displayName) ticket.closedBy.displayName = decrypt(ticket.closedBy.displayName);
			if (ticket.claimedBy?.username) ticket.claimedBy.username = decrypt(ticket.claimedBy.username);
			if (ticket.claimedBy?.displayName) ticket.claimedBy.displayName = decrypt(ticket.claimedBy.displayName);

			// Decrypt and process archived messages
			ticket.archivedMessages.forEach((message, i) => {
				// Decrypt author information
				if (message.author?.username) message.author.username = decrypt(message.author.username);
				if (message.author?.displayName) message.author.displayName = decrypt(message.author.displayName);

				// Decrypt message content
				message.content = JSON.parse(decrypt(message.content));
			});

			const templatePath = path.join(process.cwd(), 'src', 'user', 'templates', 'transcript.html');
			const template = fs.readFileSync(templatePath, 'utf8');

			const data = {
				ticket: {
					...ticket,
					createdAt: ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'N/A',
					closedAt: ticket.closedAt ? new Date(ticket.closedAt).toLocaleString() : 'N/A',
					closedReason: ticket.closedReason || 'No reason provided',
					topic: ticket.topic || 'No topic provided',
					createdBy: ticket.createdBy ? {
						...ticket.createdBy,
						username: ticket.createdBy.username || 'Unknown',
						displayName: ticket.createdBy.displayName || 'Unknown'
					} : { username: 'Unknown', displayName: 'Unknown' },
					closedBy: ticket.closedBy ? {
						...ticket.closedBy,
						username: ticket.closedBy.username || 'Unknown',
						displayName: ticket.closedBy.displayName || 'Unknown'
					} : { username: 'Unknown', displayName: 'Unknown' }
				},
				guildName: client.guilds.cache.get(ticket.guildId)?.name || 'Unknown Server',
				timestamp: new Date().toLocaleString(),
				messages: ticket.archivedMessages.map(msg => ({
					...msg,
					createdAt: new Date(msg.createdAt).toLocaleString(),
					author: {
                        ...msg.author,
                        name: msg.author?.displayName || msg.author?.username || 'Unknown',
                        avatarURL: msg.author?.userId && msg.author?.avatar
                            ? `https://cdn.discordapp.com/avatars/${msg.author.userId}/${msg.author.avatar}.png?size=128`
                            : `https://cdn.discordapp.com/embed/avatars/0.png`
                    },
                    embeds: msg.content.embeds?.map(embed => ({
                        ...embed,
                        color: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : null,
                        timestamp: embed.timestamp ? new Date(embed.timestamp).toLocaleString() : null
                    })) || [],
                    attachments: msg.content.attachments || []
				}))
			};

			const html = Mustache.render(template, data);
			return res.type('text/html').send(html);
		} catch (error) {
			client.log.error.http(error);
			return res.code(500).send({
				error: 'Internal Server Error',
				message: 'An error occurred while retrieving the transcript.',
				statusCode: 500,
			});
		}
	},
});