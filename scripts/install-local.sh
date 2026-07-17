#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${VIPER_READER_PACKAGE_DIR:-${project_root}/release/linux-unpacked}"
data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
bin_home="${XDG_BIN_HOME:-${HOME}/.local/bin}"
install_dir="${data_home}/viper-reader"
launcher_path="${bin_home}/viper-reader"

if [[ ! -x "${package_dir}/viper-reader" ]]; then
  echo "Packaged executable not found: ${package_dir}/viper-reader" >&2
  echo "Run 'npm run package:linux' first." >&2
  exit 1
fi

mkdir -p "${data_home}" "${bin_home}"

staging_dir="$(mktemp -d "${data_home}/.viper-reader.install.XXXXXX")"
backup_dir=""

cleanup() {
  rm -rf "${staging_dir}"
  if [[ -n "${backup_dir}" && -d "${backup_dir}" ]]; then
    rm -rf "${backup_dir}"
  fi
}
trap cleanup EXIT

cp -a "${package_dir}/." "${staging_dir}/"

if [[ -e "${install_dir}" ]]; then
  backup_dir="$(mktemp -d "${data_home}/.viper-reader.backup.XXXXXX")"
  rmdir "${backup_dir}"
  mv "${install_dir}" "${backup_dir}"
fi

if ! mv "${staging_dir}" "${install_dir}"; then
  if [[ -n "${backup_dir}" && -d "${backup_dir}" ]]; then
    mv "${backup_dir}" "${install_dir}"
    backup_dir=""
  fi
  exit 1
fi

if [[ -n "${backup_dir}" && -d "${backup_dir}" ]]; then
  rm -rf "${backup_dir}"
  backup_dir=""
fi

ln -sfn "${install_dir}/viper-reader" "${launcher_path}"

echo "Installed ViperReader to ${install_dir}"
echo "Launcher: ${launcher_path}"
if [[ ":${PATH}:" != *":${bin_home}:"* ]]; then
  echo "Note: add ${bin_home} to PATH to run 'viper-reader' directly."
fi
