function isPrereleaseVersion(version) {
  const [coreAndPrerelease] = version.split("+", 1);
  return coreAndPrerelease.includes("-");
}

module.exports = {
  isPrereleaseVersion,
};
