const fs = require("fs");
const path = require("path");

function findMainPackageJson(entryPath, packageName) {
  entryPath = entryPath.replace(/\//g, path.sep);
  let directoryName = path.dirname(entryPath);
  while (directoryName && !directoryName.endsWith(packageName)) {
    const parentDirectoryName = path.resolve(directoryName, "..");
    if (parentDirectoryName === directoryName) {
      break;
    }
    directoryName = parentDirectoryName;
  }

  const suspect = path.resolve(directoryName, "package.json");
  if (fs.existsSync(suspect)) {
    return JSON.parse(fs.readFileSync(suspect).toString());
  }

  return null;
}

function getSelfReferencePath(packageName) {
  let parentDirectoryName = __dirname;
  let directoryName

  while (directoryName !== parentDirectoryName) {
    directoryName = parentDirectoryName;

    try {
      const {name} = require(path.resolve(directoryName, "package.json"));

      if (name === packageName) return directoryName;
    } catch {}

    parentDirectoryName = path.resolve(directoryName, "..");
  }
}

function getPackageJson(packageName) {
  let packageJson = undefined;

  try {
    packageJson = require(`${packageName}/package.json`);
  } catch (requireError) {
    if (requireError.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      // modules's package.json does not provide the "./package.json" path at it's "exports" field
      // try to resolve manually
      try {
        const requestPath = require.resolve(packageName);
        packageJson =
          requestPath && findMainPackageJson(requestPath, packageName);
      } catch (resolveError) {
        if (resolveError.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
          console.warn(
            `Could not retrieve package.json neither through require (package.json itself is not within "exports" field), nor through require.resolve (package.json does not specify "main" field) - falling back to default resolver logic`
          );
        } else {
          console.log(
            `Unexpected error while performing require.resolve(${packageName}):`
          );
          console.error(resolveError);
          return null;
        }
      }
    } else {
      console.log(`Unexpected error while requiring ${packageName}:`);
      console.error(requireError);
      return null;
    }
  }

  return packageJson
}

module.exports = (request, options) => {
  let packageName = "";
  let submoduleName = "";

  // NOTE: jest-sequencer is a special prefixed jest request
  const isNodeModuleRequest =
    !request.startsWith(".") &&
    !request.startsWith("/") &&
    !request.startsWith("jest-sequencer");

  if (isNodeModuleRequest) {
    const pkgPathParts = request.split("/");
    const {length} = pkgPathParts;
    if(length > 1)
    {
      if (request.startsWith("@")) {
        packageName = pkgPathParts.slice(0, 2).join("/");
        submoduleName = length === 2
          ? '.' : `./${pkgPathParts.slice(2).join("/")}`;
      } else {
        packageName = pkgPathParts[0];
        submoduleName = `./${pkgPathParts.slice(1).join("/")}`;
      }
    }
  }

  if (packageName && submoduleName) {
    const selfReferencePath = getSelfReferencePath(packageName);
    if(selfReferencePath) packageName = selfReferencePath

    const packageJson = getPackageJson(packageName);

    if (!packageJson) {
      console.error(`Failed to find package.json for ${packageName}`);
    }

    const {exports, type} = packageJson || {};
    if(exports)
    {
      let targetFilePath;

      if(typeof exports === "string")
        targetFilePath = exports;

      else if (Object.keys(exports).every((k) => k.startsWith("."))) {
        const exportValue = exports[submoduleName];

        if (typeof exportValue === "string")
          targetFilePath = exportValue;

        else if (exportValue !== null && typeof exportValue === "object")
          for(const [key, value] of Object.entries(exportValue))
          {
            if (key === "import" || key === "require") {
              if (typeof value === "string")
                targetFilePath = value;
              else
              for(const [key2, value2] of Object.entries(value))
              {
                if(key2 === "node"
                || key2 === "node-addons"
                || key2 === "default") {
                  targetFilePath = value2;
                  break
                }
              }

              break
            }

            if (key === "node") {
              if (typeof value === "string")
                targetFilePath = value;
              else
                for(const [key2, value2] of Object.entries(value))
                {
                  if(key2 === "import"
                  || key2 === "require"
                  || key2 === "node-addons"
                  || key2 === "default") {
                    targetFilePath = value2;
                    break
                  }
                }

              break
            }

            if (key === "node-addons") {
              if (typeof value === "string")
                targetFilePath = value;
              else
                for(const [key2, value2] of Object.entries(value))
                {
                  if(key2 === "import"
                  || key2 === "require"
                  || key2 === "node"
                  || key2 === "default") {
                    targetFilePath = value2;
                    break
                  }
                }

              break
            }

            if (key === "default") {
              if (typeof value === "string")
                targetFilePath = value;
              else
                for(const [key2, value2] of Object.entries(value))
                  if(key2 === "import"
                  || key2 === "require"
                  || key2 === "node"
                  || key2 === "node-addons") {
                    targetFilePath = value2;
                    break
                  }

              break
            }
          }
      }

      if (targetFilePath) {
        request = targetFilePath.replace("./", `${packageName}/`);
      }
    }
  }

  return options.defaultResolver(request, options);
};
