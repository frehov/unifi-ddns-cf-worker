class BadRequestException extends Error {
	constructor(reason) {
		super(reason);
		this.status = 400;
		this.statusText = "Bad Request";
	}
}

class CloudflareApiException extends Error {
	constructor(reason, errors = null) {
		super(reason);
		this.status = 500;
		this.statusText = "Internal Server Error";
		this.errors = errors
	}
}

class Cloudflare {
	constructor(options) {
		this.cloudflare_url = "https://api.cloudflare.com/client/v4";
		this.token = options.token;
	}

	async findZone(name) {
		const response = await this._fetchWithToken(`zones?name=${name}`);
		const body = await response.json();
		if (!body.success || body.result.length === 0) {
			throw new CloudflareApiException(`Failed to find zone '${name}'`, body.errors);
		}
		return body.result[0];
	}

	async findRecord(zone, name, isIPV4 = true) {
		const rrType = isIPV4 ? "A" : "AAAA";
		const response = await this._fetchWithToken(`zones/${zone.id}/dns_records?name=${name}`);
		const body = await response.json();
		if (!body.success || body.result.length === 0) {
			throw new CloudflareApiException(`Failed to find dns record '${name}'`, body.errors);
		}
		return body.result?.filter(rr => rr.type === rrType)[0];
	}

	async createRecord(zone, name, value, isIPV4 = true, proxied = false) {
		const record = {
			content: value,
			name: name,
			proxied: proxied,
			type: isIPV4 ? "A" : "AAAA"
		}
		const response = await this._fetchWithToken(
			`zones/${zone.id}/dns_records`,
			{
				method: "POST",
				body: JSON.stringify(record),
			}
		);
		const body = await response.json();
		if (!body.success) {
			throw new CloudflareApiException("Failed to create dns record", body.errors);
		}
		return body.result
	}

	async updateRecord(record, value, proxied = false) {
		const update = {
			content: value,
			name: record.name,
			proxied,
			type: record.type
		}
		const response = await this._fetchWithToken(
			`zones/${record.zone_id}/dns_records/${record.id}`,
			{
				method: "PATCH",
				body: JSON.stringify(update),
			}
		);
		const body = await response.json();
		if (!body.success) {
			throw new CloudflareApiException("Failed to update dns record", body.errors);
		}
		return body.result;
	}

	async _fetchWithToken(endpoint, options = {}) {
		const url = `${this.cloudflare_url}/${endpoint}`;
		options.headers = {
			...options.headers,
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.token}`,
		};
		return fetch(url, options);
	}
}

function requireHttps(request) {
	const { protocol } = new URL(request.url);
	const forwardedProtocol = request.headers.get("x-forwarded-proto");

	if (protocol !== "https:" || forwardedProtocol !== "https") {
		throw new BadRequestException("Please use a HTTPS connection.");
	}
}

function parseBasicAuth(headers) {
	if(!headers.has("Authorization")) {
		return {}
	}
	const authorization = headers.get("Authorization");

	const [, base64Auth] = authorization.split(" ");
	const decoded = atob(base64Auth);
	const index = decoded.indexOf(":");

	if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
		throw new BadRequestException("Invalid authorization value.");
	}

	return {
		username: decoded?.substring(0, index),
		password: decoded?.substring(index + 1),
	};
}

async function handleRequest(request, env) {
	requireHttps(request);
	const { pathname, searchParams } = new URL(request.url);

	if (pathname === "/favicon.ico" || pathname === "/robots.txt") {
		return new Response(null, { status: 204 });
	}

	if (!pathname.endsWith("/update")) {
		// If pathname is not ending with /update
		return new Response("Not Found.", { status: 404 });
	}

	if (!request.headers.has("Authorization") && !searchParams.has("token")) {
		// If request is sent without headers or token is missing from query
		return new Response("Not Found.", { status: 404 });
	}

	let { username, password } = parseBasicAuth(request.headers);	
	// duckdns uses ?token=
	password = password || searchParams.get("token");

	if (env.BASIC_AUTH_USER !== username || env.BASIC_AUTH_PASSWORD !== password) {
		return new Response(
			"badauth",
			{
				status: 401,
				headers: new Headers({
					"WWW-Authenticate": "Basic",
				})
			}
		)
	}

	// dyndns uses ?hostname= and ?myip=
	// duckdns uses ?domains= and ?ip=
	// ydns uses ?host=
	const hostnameParam = searchParams.get("hostname") || searchParams.get("host") || searchParams.get("domains");
	const hostnames = hostnameParam?.split(",");

	// fallback to connecting IP address, assume we only ever have one IP.
	const ip = searchParams.get("ips") || searchParams.get("ip") || searchParams.get("myip") || request.headers.get("Cf-Connecting-Ip");

	if (!hostnames || hostnames.length === 0 || !ip) {
		throw new BadRequestException("You must specify both hostname(s) and IP address(es)");
	}

	// check if we're proxying through cloudflare servers
	const proxied = searchParams.has("proxied")

	const cloudflare = new Cloudflare({ token: env.CF_API_KEY });
	await informAPI(cloudflare, hostnames, ip.trim(), proxied);

	return new Response("good", {
		status: 200,
		headers: {
          	  	"Content-Type": "text/plain;charset=UTF-8",
				"Cache-Control": "no-store",
        	},
    	});
}

async function informAPI(cloudflare, hostnames, ip, proxied) {

	const isIPV4 = ip.includes("."); //poorman's ipv4 check

	const zones = new Map();

	for (const hostname of hostnames) {
		// Strip anything but the main domain
		const domainName = hostname.replace(/.*?([^.]+\.[^.]+)$/, "$1");

		if (!zones.has(domainName)) {
			zones.set(domainName, await cloudflare.findZone(domainName));
		}

		const zone = zones.get(domainName);
		await cloudflare.findRecord(zone, hostname, isIPV4)
			.then(
				// Update record if it's present
				async (record) => await cloudflare.updateRecord(record, ip, proxied),
				// Create record if it doesn't exist
				async (_err) => await cloudflare.createRecord(zone, hostname, ip, isIPV4, proxied)
			)
	}
}

export default {
	async fetch(request, env, ctx) {
		return handleRequest(request, env).catch((err) => {
			console.error(err.constructor.name, err);
			const message = err.reason || err.stack || "Unknown Error";

			return new Response(message, {
				status: err.status || 500,
				statusText: err.statusText || null,
				headers: {
					"Content-Type": "text/plain;charset=UTF-8",
					"Cache-Control": "no-store",
					"Content-Length": message.length,
				},
			});
		});
	},
};
