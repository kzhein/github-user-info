import { parseHTML } from 'https://esm.sh/linkedom@0.11/worker';
import { Redis } from 'https://deno.land/x/upstash_redis/mod.ts';

const redis = new Redis({
  url: Deno.env.get('REDIS_URL'),
  token: Deno.env.get('REDIS_TOKEN'),
});

const getProfile = async username => {
  const res = await fetch(`https://github.com/${username}`);

  if (res.status === 404) {
    const error = new Error('User not found!');
    error.status = 404;
    throw error;
  }

  const data = await res.text();

  const { document } = parseHTML(data);

  const organizaionContainer = document.querySelector(
    '[itemtype="http://schema.org/Organization"]'
  );
  const isOrganization = !!organizaionContainer;
  const fullname =
    (isOrganization
      ? organizaionContainer.querySelector('h1')?.textContent?.trim()
      : document.querySelector('[itemprop="name"]')?.textContent?.trim()) ||
    undefined;
  const location = isOrganization
    ? document.querySelector('[itemprop="location"]')?.textContent?.trim()
    : document.querySelector('[itemprop="homeLocation"]')?.textContent?.trim();
  const email = document
    .querySelector('[itemprop="email"]')
    ?.textContent?.trim();
  const url = document.querySelector('[itemprop="url"]')?.textContent?.trim();
  const socials = isOrganization
    ? [...document.querySelectorAll('a.Link--primary')].map(a => a.href)
    : [...document.querySelectorAll('[itemprop="social"]')].map(sc => {
        return sc.href ? sc.href : sc.querySelector('a').href;
      });
  let links = [url, ...socials].filter(link => link);
  links = links.length > 0 ? links : undefined;

  return { username, fullname, location, email, links };
};

const digEmail = async username => {
  const data = await fetch(
    `https://github.com/${username}?tab=repositories&type=source`
  ).then(res => res.text());
  const { document } = parseHTML(data);
  const repo = document.querySelector(
    '[itemtype="http://schema.org/Code"] h3 a'
  )?.href;

  if (!repo) {
    return undefined;
  }

  const commitsData = await fetch(
    `https://github.com${repo}/commits?author=${username}`
  ).then(res => res.text());
  const { document: commitsPageDocument } = parseHTML(commitsData);
  const commit = commitsPageDocument.querySelector(
    'a[aria-label="View commit details"]'
  ).href;

  const rawData = await fetch(`https://github.com${commit}.patch`).then(res =>
    res.text()
  );

  const lineWithEmail = rawData.split('\n')?.[1];

  if (!lineWithEmail) {
    return undefined;
  }

  const email = /<(.*)>/.exec(lineWithEmail)?.[1];

  return email;
};

export default async req => {
  try {
    const searchParams = new URL(req.url).searchParams;
    const username = searchParams.get('username');

    if (!username) {
      return new Response(JSON.stringify({ message: 'No username' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const cachedProfile = await redis.get(username);
    if (cachedProfile) {
      return new Response(cachedProfile, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const profile = await getProfile(username);
    profile.email = profile.email || (await digEmail(username));

    await redis.set(username, JSON.stringify(profile), {
      ex: 7 * 24 * 60 * 60,
    }); // cache for 7 days

    return new Response(JSON.stringify(profile), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message }), {
      status: err.status || 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};

export const config = { path: '/scrape' };
