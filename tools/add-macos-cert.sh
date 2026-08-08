# Based on https://github.com/electron/fiddle/blob/c3f3e9cc30a2341970575e27a7117a71e56e0b2a/tools/add-macos-cert.sh
#!/usr/bin/env bash

set -eo pipefail

KEY_CHAIN=build.keychain
MACOS_CERT_P12_FILE=certificate.p12

# Check if the variable is set
if [ -n "$MACOS_CERT_P12" ]; then
  # If the variable is set, print its length
  variable_length=${#MACOS_CERT_P12}
  echo "MACOS_CERT_P12 is set. Length: $variable_length"
else
  # If the variable is not set, print a message
  echo "MACOS_CERT_P12 is not set."
fi

# Recreate the certificate from the secure environment variable
echo -n "$MACOS_CERT_P12" | base64 -d > "$MACOS_CERT_P12_FILE"
file_size=$(stat -f%z "$MACOS_CERT_P12_FILE")
echo "Certificate size is $file_size bytes"

# Create a keychain
security create-keychain -p actions $KEY_CHAIN

# Make the keychain the default so identities are found
security default-keychain -s $KEY_CHAIN

# Unlock the keychain
security unlock-keychain -p actions $KEY_CHAIN

# The latest Developer ID Intermediate Certificate from Apple is
# missing on GitHub Actions (?), but we need it for the cert to be valid
curl https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer -o DeveloperIDG2CA.cer
sudo security add-trusted-cert -d -r unspecified -k $KEY_CHAIN DeveloperIDG2CA.cer
rm -f DeveloperIDG2CA.cer

security import $MACOS_CERT_P12_FILE -k $KEY_CHAIN -P "$MACOS_CERT_PASSWORD" -T /usr/bin/codesign;

security set-key-partition-list -S apple-tool:,apple: -s -k actions $KEY_CHAIN

# Debugging output
security find-identity

# remove certs
rm -fr *.p12