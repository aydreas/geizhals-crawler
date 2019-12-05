"use strict";

const nodemailer = require("nodemailer");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { parse } = require("node-html-parser");

const config = JSON.parse(fs.readFileSync("lists.json", { encoding: "utf8" }));

const callback = (resp, mode = 'price', price = 0) => {
	let data = '';

	resp.on('data', (chunk) => {
		data += chunk;
	});

	resp.on('end', () => {
		const products = resolve(data);
		switch (mode) {
			case 'price':
				products.forEach(x => {
					if (x.price <= price)
						sendMail(x);
				});
				break;
			case 'unit':
				products.forEach(x => {
					if (x.pricePerUnit <= price)
						sendMail(x);
				});
				break;
		}
	});
};

config.forEach(x => {
	if (!x.url)
		return;

	const url_price = x.url.replace(/&sort=[^&=#]|(#)|$/, "&sort=p$1");
	const url_unit = x.url.replace(/&sort=[^&=#]|(#)|$/, "&sort=r$1");

	if (x.url.startsWith('https')) {
		if (x.targetPrice)
			https.get(url_price, x => callback(x, 'price', x.targetPrice))
				.on('error', err => console.error(err.message));
		if (x.targetUnitPrice)
			https.get(url_unit, x => callback(x, 'unit', x.targetUnitPrice))
				.on('error', err => console.error(err.message));
	} else {
		if (x.targetPrice)
			http.get(url_price, x => callback(x, 'price', x.targetPrice))
				.on('error', err => console.error(err.message));
		if (x.targetUnitPrice)
			http.get(url_unit, x => callback(x, 'unit', x.targetUnitPrice))
				.on('error', err => console.error(err.message));
	}
});

function resolve(html) {
	let products = [];

	parse(html).querySelectorAll('.filtercategory__productlist .productlist__product').forEach(x => {
		const name = x.querySelector('.productlist__link span').innerHTML.trim();
		const link = 'https://geizhals.at/' + x.querySelector('.productlist__link').attributes.href.trim();
		const price = Number(x.querySelector('.productlist__price .gh_price .gh_price').innerHTML.replace(/[^0-9,.]/, '').replace(',', '.').trim());
		const pricePerUnit = Number(x.querySelector('.productlist__price .gh_pricePerUnit span').innerHTML.replace(/[^0-9,.]/, '').replace(',', '.').trim());

		products.push({name, link, price, pricePerUnit});
	});

	return products;
}

function sendMail(product) {

}
