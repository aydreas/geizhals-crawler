"use strict";

const configPath = 'config.json';
const logPath = 'logs';
const cachePath = 'cache.json';

const nodemailer = require('nodemailer');
const http = require('http');
const https = require('https');
const fs = require('fs');
const URL = require('url').URL;
const { parse } = require('node-html-parser');

process.stdout._orig_write = process.stdout.write;
process.stdout.write = (data) => {
	fs.appendFile(logPath, `[${new Date().toISOString()}][INFO] ${data.substring(0, data.length - 1).replace('\n', '\n\t- ')}${data.endsWith('\n') ? '\n' : data.charAt(data.length - 1) + '\n'}`, () => {});
	process.stdout._orig_write(data);
};
process.stderr._orig_write = process.stderr.write;
process.stderr.write = (data) => {
	fs.appendFile(logPath, `[${new Date().toISOString()}][ERR] ${data.substring(0, data.length - 1).replace('\n', '\n\t- ')}${data.endsWith('\n') ? '\n' : data.charAt(data.length - 1) + '\n'}`, () => {});
	process.stderr._orig_write(data);
};

const httpReq = (options = {}, ssl = false) => new Promise((resolve, reject) => {
	if (options.body) {
		if (!options.headers)
			options.headers = {};
		options.headers['Content-Length'] = options.body.length;
	}

	let req = (ssl ? https : http).request(options, (res) => {
		if (res.statusCode < 200 || res.statusCode >= 300) {
			reject(new Error(JSON.stringify({
				request: options,
				statusCode: res.statusCode
			})));
		}

		let response = res;
		let body = [];

		res.on('data', (chunk) => {
			body.push(chunk);
		});
		res.on('end', () => {
			response.body = Buffer.concat(body).toString();
			resolve(response);
		});
	});

	req.on('error', (err) => {
		reject(err);
	});
	req.on('timeout', () => {
		req.abort();
		reject(new Error(JSON.stringify({
			request: options,
			statusCode: '<timed out>'
		})));
	});

	if (options.body)
		req.write(options.body);
	req.end();
});

const config = JSON.parse(fs.readFileSync(configPath, { encoding: 'utf8' }));
let cache = fs.existsSync(cachePath) ?
	JSON.parse(fs.readFileSync(cachePath, {encoding: 'utf8'})) : {};
const transporter = nodemailer.createTransport({
	host: config.mail.host || '',
	port: config.mail.port || 465,
	secure: config.mail.secure || false,
	auth: {
		user: config.mail.user || '',
		pass: config.mail.pass || ''
	}
});

async function run() {
	let promises = [];
	for (const x of config.searches) {
		if (!x.url)
			continue;

		const url = new URL(x.url);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			console.error(`URL: '${x.url}' has no valid protocol.`);
			continue;
		}

		if (x.targetPrice) {
			const resp = await httpReq({
				hostname: url.hostname,
				port: url.port,
				method: 'GET',
				path: url.pathname + url.search.replace(/&sort=[^&=#]|(#)|$/, "&sort=p$1") + url.hash,
				timeout: 10000
			}, url.protocol === 'https:')
				.catch(err => console.error(err));

			const products = resolveHTML(resp.body);

			if (!cache[x.name]) {
				cache[x.name] = {
					price: [],
					unit: []
				};
			}

			products.forEach(y => {
				if (y.price <= x.targetPrice && !cache[x.name].price.find(z => z.link === y.link))
					promises.push(sendMail(y, x.name));
			});
			cache[x.name].price = products;
		}
		if (x.targetUnitPrice) {
			const resp = await httpReq({
				hostname: url.hostname,
				port: url.port,
				method: 'GET',
				path: url.pathname + url.search.replace(/&sort=[^&=#]|(#)|$/, "&sort=r$1") + url.hash,
				timeout: 10000
			}, url.protocol === 'https:')
				.catch(err => console.error(err));

			const products = resolveHTML(resp.body);

			if (!cache[x.name]) {
				cache[x.name] = {
					price: [],
					unit: []
				};
			}

			products.forEach(y => {
				if (y.pricePerUnit <= x.targetUnitPrice && !cache[x.name].unit.find(z => z.link === y.link))
					promises.push(sendMail(y, x.name));
			});
			cache[x.name].unit = products;
		}
	}
	fs.writeFileSync(cachePath, JSON.stringify(cache));
	await Promise.all(promises);
}

function resolveHTML(html) {
	let products = [];

	parse(html).querySelectorAll('.filtercategory__productlist .productlist__product').forEach(x => {
		const name = x.querySelector('.productlist__link span').innerHTML.trim();
		const link = 'https://geizhals.at/' + x.querySelector('.productlist__link').attributes.href.trim();
		const price = Number(x.querySelector('.productlist__price .gh_price span').innerHTML.replace(/[^0-9,.]/g, '').replace(',', '.').trim());
		const pricePerUnit = Number(x.querySelector('.productlist__price .gh_pricePerUnit span').innerHTML.replace(/[^0-9,.]/g, '').replace(',', '.').trim());

		products.push({name, link, price, pricePerUnit});
	});

	return products;
}

async function sendMail(product, name) {
	console.log(`Sending mail(s) about product: '${product.name}' to [${config.recipients.join(', ')}]`);
	await transporter.sendMail({
		from: '"Geizhals Crawler" <geizhals.crawler@gmail.com>',
		to: config.recipients.join(','),
		subject: 'New Deal found!',
		html: fs.readFileSync('mail.html', {encoding: 'utf8'})
			.replace('%%search%%', name)
			.replace('%%link%%', product.link)
			.replace('%%name%%', product.name)
			.replace('%%price%%', product.price)
			.replace('%%pricePerUnit%%', product.pricePerUnit)
	});
}

run().catch(x => console.error(x));
