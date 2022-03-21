const fs = require("fs");
const path = require("path");

const noOp = () => 0;
const { log = noOp, warn= noOp, error= noOp } = process.env.VERBOSE_JEST_NODE_EXPORTS_RESOLVER ? console : {};

function findMainPackageJson(entryPath, packageName) {
  entryPath = entryPath.replace(/\//g, path.sep);

  let directoryName = path.dirname(entryPath);
  while (directoryName && !directoryName.endsWith(packageName)) {
    const parentDirectoryName = path.resolve(directoryName, "..");

    if (parentDirectoryName === directoryName) break;

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
  // Require `package.json` from the package, both from exported `exports` field
  // in ESM packages, or directly from the file itself in CommonJS packages.
  try {
    return require(`${packageName}/package.json`);
  } catch (requireError) {
    if (requireError.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      return error(
        `Unexpected error while requiring ${packageName}:`, requireError
      );
    }
  }

  // modules's `package.json` does not provide the "./package.json" path at it's
  // "exports" field. Get package level export or main field and try to resolve
  // the package.json from it.
  try {
    const requestPath = require.resolve(packageName);

    return requestPath && findMainPackageJson(requestPath, packageName);
  } catch (resolveError) {
    if (resolveError.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      log(
        `Unexpected error while performing require.resolve(${packageName}):`
      );

      return error(resolveError);
    }
  }

  // modules's `package.json` does not provide a package level export nor main
  // field. Try to find the package manually from `node_modules` folder.
  const suspect = path.resolve(__dirname, "..", packageName, "package.json");
  if (fs.existsSync(suspect)) {
    return JSON.parse(fs.readFileSync(suspect).toString());
  }

  warn(
    'Could not retrieve package.json neither through require (package.json ' +
    'itself is not within "exports" field), nor through require.resolve ' +
    '(package.json does not specify "main" field) - falling back to default ' +
    'resolver logic'
  );
}

module.exports = (request, options) => {
  const {conditions, defaultResolver} = options;

  // NOTE: jest-sequencer is a special prefixed jest request
  const isNodeModuleRequest =
  !(
    request.startsWith(".") ||
    request.startsWith("/") ||
    request.startsWith("jest-sequencer")
  );

  if (isNodeModuleRequest) {
    const pkgPathParts = request.split("/");
    const {length} = pkgPathParts;

    let packageName;
    let submoduleName;

    if (!request.startsWith("@")) {
      packageName = pkgPathParts.shift();
      submoduleName = length > 1 ? `./${pkgPathParts.join("/")}` : ".";
    } else if (length >= 2) {
      packageName = `${pkgPathParts.shift()}/${pkgPathParts.shift()}`;
      submoduleName = length > 2 ? `./${pkgPathParts.join("/")}` : ".";
    }

    if (packageName && submoduleName) {
      const selfReferencePath = getSelfReferencePath(packageName);
      if(selfReferencePath) packageName = selfReferencePath

      const packageJson = getPackageJson(packageName);

      if (!packageJson) {
        error(`Failed to find package.json for ${packageName}`);
      }

      const {exports} = packageJson || {};
      if(exports)
      {
        let targetFilePath;

        if(typeof exports === "string")
          targetFilePath = exports;

        else if (Object.keys(exports).every((k) => k.startsWith("."))) {
          const globRegex = /[/*](.js(on)?)?$/;
          const [exportKey, exportValue] = Object.entries(exports)
          .find(([k]) => {
            if (k === submoduleName) return true;
            if (globRegex.test(k)) return submoduleName.startsWith(k.replace(globRegex, ""))
            return false;
          }) || [];

          if (typeof exportValue === "string")
            targetFilePath = globRegex.test(exportKey)
              ? exportValue.replace(globRegex, submoduleName.slice(exportKey.replace(globRegex, "").length))
              : exportValue;

          else if (
            conditions && exportValue != null && typeof exportValue === "object"
          ){
            function resolveExport(exportValue, prevKeys)
            {
              for(const key of ["node", "require", "default"])
              {
                const value = exportValue[key];

                if (!value) continue;
                
                // Duplicated nested conditions are undefined behaviour (and
                // probably a format error or spec loop-hole), abort and
                // delegate to Jest default resolver
                if(prevKeys.includes(key)) continue

                if (typeof value === "string") return value

                const nestedValue = resolveExport(value, prevKeys.concat(key));

                if (nestedValue) return nestedValue;
              }
            }

            targetFilePath = resolveExport(exportValue, []);
          }
        }

        if (targetFilePath) {
          request = targetFilePath.replace("./", `${packageName}/`);
        }
      }
    }
  }

  return defaultResolver(request, options);
};
