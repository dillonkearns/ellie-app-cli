import fs from "node:fs";
import spawn from "cross-spawn-with-kill";
import path from "node:path";
import openEditor from "open-editor";
import fetch from "node-fetch";
import { Command } from "commander/esm.mjs";
import { globby } from "globby";

let elmLiveProcess;

export function start() {
  process.on("SIGTERM", () => {
    elmLiveProcess && elmLiveProcess.kill();
  });
  process.on("SIGINT", () => {
    elmLiveProcess && elmLiveProcess.kill();
    process.exit(0);
  });
  process.on("exit", () => {
    elmLiveProcess && elmLiveProcess.kill();
  });
  const program = new Command();
  program
    .argument("<ellie-id-or-url>", "the id or URL for an ellie-app example")
    .action((ellieId) => run(ellieId));

  program.parse(process.argv);
}

async function getRepo(ellieId) {
  let url = "https://ellie-app.com/api";

  let options = {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query {
  revision(id: "${ellieId}") {
    elmCode
    elmVersion
    htmlCode
    title
    packages {
      name
      version
    }
  }
}`,
    }),
  };

  return fetch(url, options)
    .then((res) => res.json())
    .catch((err) => console.error("error:" + err));
}

async function run(ellieId) {
  let elmModuleName;
  if (!fs.existsSync(ellieId)) {
    fs.mkdirSync(ellieId);
    process.chdir(ellieId);
    const json = await getRepo(ellieId);
    elmModuleName = await writeFiles(ellieId, json);
  } else {
    process.chdir(ellieId);
    elmModuleName = await findEntrypoint();
  }

  openEditor(["./", path.join("src", `${elmModuleName.join("/")}.elm`)]);
  openElmLive(elmModuleName);
}

async function writeFiles(ellieId, json) {
  const scriptTag = `<script src="/elm.js"></script>`;
  const packages = json.data.revision.packages;
  const htmlCode = json.data.revision.htmlCode.replace(
    /<script/,
    `${scriptTag}<script`
  );
  const elmVersion = json.data.revision.elmVersion;
  const elmCode = json.data.revision.elmCode;
  const elmModuleName = elmCode
    .match(/module\s+(\S*)\s+exposing\s+\(.*\)/)[1]
    .split(".");
  fs.writeFileSync("index.html", htmlCode);
  fs.mkdirSync("src");
  fs.writeFileSync(`src/${elmModuleName.join("/")}.elm`, elmCode);
  fs.writeFileSync("elm.json", elmJson());

  fs.writeFileSync(".gitignore", gitignoreFile());
  await elmJsonInstall(packages);
  await setupRepo(ellieId);
  return elmModuleName;
}

function elmJson() {
  return `{
    "type": "application",
    "source-directories": [
        "src"
    ],
    "elm-version": "0.19.1",
    "dependencies": {
        "direct": {},
        "indirect": {}
    },
    "test-dependencies": {
        "direct": {},
        "indirect": {}
    }
}
`;
}

async function elmJsonInstall(packages) {
  let packageInstallArgs = packages.map((elmPackage) => {
    return `${elmPackage.name}@${elmPackage.version}`;
  });
  const includesElmCore = packages.some((elmPackage) => {
    return elmPackage.name === "elm/core";
  });
  if (!includesElmCore) {
    packageInstallArgs = packageInstallArgs.push("elm/core");
  }
  await spawnPromise("elm-json", ["install", "--yes", ...packageInstallArgs]);
}

async function setupRepo(ellieId) {
  await spawnPromise("git", ["init"]);
  await spawnPromise("git", ["add", "--all"]);
  await spawnPromise("git", [
    "commit",
    "--message",
    `Initial code from https://ellie-app.com/${ellieId}.`,
  ]);
}

function gitignoreFile() {
  return `elm-stuff/
elm.js
`;
}

function openElmLive(elmModuleName) {
  elmLiveProcess = spawn(
    "elm-live",
    [
      `src/${elmModuleName.join("/")}.elm`,
      "--open",
      "--",
      "--output",
      "elm.js",
    ],
    {
      stdio: "inherit",
    }
  );
}

function spawnPromise(commandName, commandArgs) {
  return new Promise(function (resolve, reject) {
    const spawnProcess = spawn(commandName, commandArgs, {
      stdio: "inherit",
    });
    spawnProcess.addListener("error", reject);
    spawnProcess.addListener("exit", resolve);
  });
}

async function findEntrypoint() {
  const paths = await globby(["./src/**/*.elm"]);
  if (paths.length !== 1) {
    throw `Error: found more than one entrypoint: ${paths}`;
  } else {
    return paths[0].match(/\/([^\/]*)\.elm/)[1].split(".");
  }
}
