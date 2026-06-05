function isPrereleaseVersion(version) {
  return version.includes("-");
}

module.exports = {
  isPrereleaseVersion,
};
