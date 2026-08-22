#!/bin/bash
set -euo pipefail

APPLE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${1:-${APPLE_ROOT}/release}"
VERSION="$(awk '/MARKETING_VERSION:/ { print $2; exit }' "${APPLE_ROOT}/project.yml" | tr -d '\"')"
IPA_NAME="MazenmiXTream-iOS-v${VERSION}-unsigned.ipa"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/MazenmiXTreamIPA.XXXXXX")"
DERIVED_DATA="${TEMP_ROOT}/DerivedData"
STAGING_DIR="${TEMP_ROOT}/Staging"

cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

cd "${APPLE_ROOT}"
xcodegen generate --spec project.yml
pod install

xcodebuild \
  -workspace MazenmiXTream.xcworkspace \
  -scheme MazenmiXTream \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "${DERIVED_DATA}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  "CODE_SIGN_IDENTITY=" \
  build

APP_PATH="${DERIVED_DATA}/Build/Products/Release-iphoneos/MazenmiXTream.app"
INFO_PLIST="${APP_PATH}/Info.plist"

if [[ ! -d "${APP_PATH}" || ! -f "${INFO_PLIST}" ]]; then
  echo "Release iPhoneOS application bundle was not created." >&2
  exit 1
fi

EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${INFO_PLIST}")"
BUNDLE_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${INFO_PLIST}")"
EXECUTABLE_PATH="${APP_PATH}/${EXECUTABLE_NAME}"

if [[ "${BUNDLE_IDENTIFIER}" != "com.mazenmix.xtream.ios" ]]; then
  echo "Unexpected Bundle ID: ${BUNDLE_IDENTIFIER}" >&2
  exit 1
fi

if ! file "${EXECUTABLE_PATH}" | grep -q 'arm64'; then
  echo "The packaged application is not an arm64 iPhoneOS binary." >&2
  exit 1
fi

mkdir -p "${STAGING_DIR}/Payload" "${OUTPUT_DIR}"
ditto "${APP_PATH}" "${STAGING_DIR}/Payload/MazenmiXTream.app"

IPA_PATH="${OUTPUT_DIR}/${IPA_NAME}"
(
  cd "${STAGING_DIR}"
  /usr/bin/zip -qry "${IPA_PATH}" Payload
)

unzip -t "${IPA_PATH}"
shasum -a 256 "${IPA_PATH}" | tee "${IPA_PATH}.sha256"
echo "Unsigned iPhoneOS IPA created at ${IPA_PATH}"
