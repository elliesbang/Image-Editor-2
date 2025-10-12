import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const projectName = process.env.CLOUDFLARE_PROJECT_NAME;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const productionBranch = process.env.PRODUCTION_BRANCH || 'main';

if (!accountId || !projectName || !apiToken) {
  throw new Error('Missing Cloudflare configuration. Ensure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_PROJECT_NAME, and CLOUDFLARE_API_TOKEN are set.');
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;

const defaultHeaders = {
  Authorization: `Bearer ${apiToken}`,
  'Content-Type': 'application/json',
};

async function cfFetch(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...defaultHeaders,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare API request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(`Cloudflare API response unsuccessful: ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}

async function ensureProductionBranch() {
  const project = await cfFetch('');
  if (project.production_branch !== productionBranch) {
    await cfFetch('', {
      method: 'PATCH',
      body: JSON.stringify({
        production_branch: productionBranch,
      }),
    });
    console.log(`Updated Cloudflare Pages production branch to "${productionBranch}".`);
  } else {
    console.log(`Cloudflare Pages production branch already set to "${productionBranch}".`);
  }
}

function readGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }

  try {
    const raw = readFileSync(eventPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Unable to read GitHub event payload:', error);
    return null;
  }
}

function ensureMergeCommit() {
  const event = readGitHubEvent();
  if (!event) {
    return false;
  }

  const commits = Array.isArray(event.commits) ? event.commits : [];
  const headCommit = event.head_commit;

  if (commits.length === 0 || !headCommit) {
    console.log('No merge commit detected. Creating an empty commit to trigger deployment.');
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync('git commit --allow-empty -m "chore: force redeploy"', { stdio: 'inherit' });
    execSync(`git push origin ${productionBranch}`, { stdio: 'inherit' });
    return true;
  }

  console.log('Merge commit detected in GitHub payload.');
  return false;
}

function extractLogsUrl(deployment) {
  if (!deployment || typeof deployment !== 'object') {
    return null;
  }
  return (
    deployment.build_logs_url ||
    deployment.deployment_trigger?.metadata?.build_logs_url ||
    deployment.latest_stage?.log ||
    null
  );
}

async function fetchDeploymentLogs(deployment) {
  const logUrl = extractLogsUrl(deployment);
  if (!logUrl) {
    return '';
  }

  const response = await fetch(logUrl, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    console.warn(`Unable to fetch build logs (${response.status}).`);
    return '';
  }

  return response.text();
}

async function getLatestDeployment() {
  const deployments = await cfFetch(`/deployments?branch=${encodeURIComponent(productionBranch)}&page=1&per_page=1`);
  if (!deployments || deployments.length === 0) {
    return null;
  }
  return deployments[0];
}

async function waitForDeploymentCompletion(deploymentId) {
  const pollInterval = Number(process.env.DEPLOYMENT_POLL_INTERVAL_MS || 10000);
  const timeout = Number(process.env.DEPLOYMENT_TIMEOUT_MS || 15 * 60 * 1000);
  const endTime = Date.now() + timeout;

  while (Date.now() < endTime) {
    const deployment = await cfFetch(`/deployments/${deploymentId}`);
    const status = deployment.latest_stage?.status || deployment.status;

    if (status === 'success') {
      const logs = await fetchDeploymentLogs(deployment);
      if (logs && logs.includes('Deployment completed successfully')) {
        console.log('✅ 최신 빌드 반영 완료');
      } else {
        console.log('Deployment succeeded but completion message not found in logs.');
      }
      return;
    }

    if (status === 'failure' || status === 'failed' || status === 'canceled') {
      throw new Error(`Deployment ${deploymentId} ended with status: ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timed out waiting for deployment ${deploymentId} to complete.`);
}

async function triggerDeployment() {
  console.log('Triggering Cloudflare Pages deployment with cache bypass.');
  const deployment = await cfFetch('/deployments', {
    method: 'POST',
    body: JSON.stringify({
      branch: productionBranch,
      build_config: {
        skip_build_cache: true,
      },
    }),
  });

  await waitForDeploymentCompletion(deployment.id);
}

async function maybeTriggerDeploymentFromLogs() {
  const latestDeployment = await getLatestDeployment();
  if (!latestDeployment) {
    console.log('No existing deployment found. Triggering initial deployment.');
    await triggerDeployment();
    return;
  }

  const logs = await fetchDeploymentLogs(latestDeployment);
  if (logs && logs.includes('No changes detected, skipping build.')) {
    console.log('Detected skipped build in logs. Forcing new deployment.');
    await triggerDeployment();
  } else {
    console.log('No skipped build detected in latest logs.');
  }
}

(async () => {
  await ensureProductionBranch();
  const forcedCommit = ensureMergeCommit();
  if (!forcedCommit) {
    await maybeTriggerDeploymentFromLogs();
  } else {
    console.log('Empty commit pushed to trigger deployment; skipping API trigger in current run.');
  }
})();
