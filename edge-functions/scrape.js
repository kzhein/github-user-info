import { parseHTML } from 'https://esm.sh/linkedom@0.11/worker';

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
    `https://github.com/${username}?tab=repositories`
  ).then(res => res.text());
  const { document } = parseHTML(data);
  const repo = document.querySelector(
    '[itemtype="http://schema.org/Code"] h3 a'
  )?.href;

  if (!repo) {
    return undefined;
  }

  const repoPageData = await fetch(`https://github.com${repo}`).then(res =>
    res.text()
  );
  const { document: repoPageDocument } = parseHTML(repoPageData);

  const lastCommit = repoPageDocument.querySelector('a[data-hotkey="y"]')?.href;

  if (!lastCommit) {
    return undefined;
  }

  const commitHash = lastCommit.split('/').at(-1);

  const rawData = await fetch(
    `https://github.com${repo}/commit/${commitHash}.patch`
  ).then(res => res.text());

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
      });
    }

    const profile = await getProfile(username);
    profile.email = profile.email || (await digEmail(username));

    return new Response(JSON.stringify(profile, null, 2));
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message }), {
      status: err.status || 500,
    });
  }
};

export const config = { path: '/scrape' };
