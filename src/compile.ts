import path from "path";
import * as fs from "fs";
import { getLogger } from "./util";
import { ARTIFACT_FORMAT_VERSION } from "./constants";
import { localPathToSourceName } from "hardhat/utils/source-names";
import { Artifact, Artifacts, ProjectPathsConfig } from "hardhat/types";
import { Artifacts as ArtifactsImpl } from "hardhat/internal/artifacts";

const log = getLogger("compile");

function getFeTempOutputFolder() {
  return process.cwd() + "/fe_output";
}

function isLegacyVersion(feVersion: string) {
  let [major, minor] = feVersion.split("-")[0].split(".");
  // versions earlier before v0.18.0-alpha
  return major == "0" && (parseInt(minor) <= 18);
}

function compileFileWithFeBinary(fePath: string, feVersion: string, fileName: string) {
  const fe_options = "--overwrite --emit=abi,bytecode";
  const outputFolder = getFeTempOutputFolder();

  if (fileName.endsWith(".git")) fileName = fileName.slice(0, -4);
  // if (!fileName.endsWith(".fe")) return;

  var compileCommand;
  if (isLegacyVersion(feVersion)) {
    compileCommand = `${fePath} ${fileName} ${fe_options} --output-dir ${outputFolder}`;
  } else {
    compileCommand = `${fePath} build ${fileName} ${fe_options} --output-dir ${outputFolder}`;
  }

  try {
    log(compileCommand);
    require("child_process").execSync(compileCommand);
  } catch (e) {
    console.log("[Compiler Exception] " + e);
  }
}

function getCompileResultFromBinaryBuild() {
  var compilerResult: { [k: string]: any } = {};
  compilerResult.contracts = {};
  const FE_OUTPUT = fs.readdirSync("fe_output");
  for (const fileName of FE_OUTPUT) {
    compilerResult.contracts[fileName] = {};
    compilerResult.contracts[fileName].bytecode = fs.readFileSync(
      `fe_output/${fileName}/${fileName}.bin`,
      "utf8"
    );
    compilerResult.contracts[fileName].abi = fs.readFileSync(
      `fe_output/${fileName}/${fileName}_abi.json`,
      "utf8"
    );
    compilerResult.contracts[fileName].abi = JSON.parse(compilerResult.contracts[fileName].abi);
  }
  return compilerResult;
}

function cleanup() {
  const outputFolder = getFeTempOutputFolder();
  const cleanUpCommand = `rm -rf ${outputFolder}`;
  require("child_process").execSync(cleanUpCommand);
}

function isIngotProject(files: string[]): [boolean, string] {
  for (const file of files) {
    if (file.endsWith("main.fe")) {
      return [true, file.replace("/main.fe", "")];
    }
  }
  return [false, ""];
}

export async function compile(
  fePath: string,
  feVersion: string,
  paths: ProjectPathsConfig,
  artifacts: Artifacts
) {
  const files = await getFeSources(paths);
  log(files);

  const [isIngot, ingotModule] = isIngotProject(files);

  if (isIngot) {
    const sourceName = await localPathToSourceName(paths.root, `${ingotModule}/main.fe`);
    console.log(`Compiling module ${ingotModule} with Fe binary ${fePath}`);
    compileFileWithFeBinary(fePath, feVersion, ingotModule);

    const compilerResult = getCompileResultFromBinaryBuild();
    log("compilerResult:", compilerResult);

    let contractNames = [];
    for (const key of Object.keys(compilerResult.contracts)) {
      const artifact = getArtifactFromFeOutput(
        sourceName,
        key,
        compilerResult.contracts[key]
      );
      log("artifact:", artifact);
      // https://github.com/NomicFoundation/hardhat/blob/master/packages/hardhat-ethers/src/internal/helpers.ts#L20
      await artifacts.saveArtifactAndDebugFile(artifact);
      contractNames.push(artifact.contractName);
    }
    const artifactsImpl = artifacts as ArtifactsImpl;
    artifactsImpl.addValidArtifacts([{ sourceName: sourceName, artifacts: contractNames }]);

    cleanup();
  } else {
    for (const file of files) {
      const sourceName = await localPathToSourceName(paths.root, file);
      console.log(`Compiling ${file} with Fe binary ${fePath}`);
      compileFileWithFeBinary(fePath, feVersion, file);
      
      const compilerResult = getCompileResultFromBinaryBuild();
      log("compilerResult:", compilerResult);
  
      let contractNames = [];
      for (const key of Object.keys(compilerResult.contracts)) {
        const artifact = getArtifactFromFeOutput(
          sourceName,
          key,
          compilerResult.contracts[key]
        );
        log("artifact:", artifact);
        // https://github.com/NomicFoundation/hardhat/blob/master/packages/hardhat-ethers/src/internal/helpers.ts#L20
        await artifacts.saveArtifactAndDebugFile(artifact);
        contractNames.push(artifact.contractName);
      }
      const artifactsImpl = artifacts as ArtifactsImpl;
      artifactsImpl.addValidArtifacts([{ sourceName: sourceName, artifacts: contractNames }]);
  
      cleanup();
    }
  }
}

async function getFeSources(paths: ProjectPathsConfig) {
  const glob = await import("glob");
  const feFiles = glob.sync(path.join(paths.sources, "**", "*.fe"));

  return feFiles;
}

function getArtifactFromFeOutput(
  sourceName: string,
  contractName: string,
  output: any
): Artifact {

  return {
    _format: ARTIFACT_FORMAT_VERSION,
    contractName,
    sourceName,
    abi: output.abi,
    bytecode: add0xPrefixIfNecessary(output.bytecode),
    deployedBytecode: "", //add0xPrefixIfNecessary(output.bytecode_runtime),
    linkReferences: {},
    deployedLinkReferences: {},
  };
}

function add0xPrefixIfNecessary(hex: string): string {
  log("...hex...");
  log(hex);
  hex = hex.toLowerCase();

  if (hex.slice(0, 2) === "0x") {
    return hex;
  }

  return `0x${hex}`;
}
