# frozen_string_literal: true

# Homebrew formula for metro (npm package @metrocli/metro).
# SPDX-License-Identifier: Apache-2.0
#
# Install once the tap is published:
#   brew tap metrocli/tap https://github.com/metrocli/homebrew-tap
#   brew install metrocli
#
# Release steps: packaging/homebrew/TAP.md

class Metrocli < Formula
  desc "Metronome in your terminal: safe previews, typed confirms and read-back proof"
  homepage "https://metrocli.com"
  url "https://registry.npmjs.org/@metrocli/metro/-/metro-0.1.1.tgz"
  # Set at release time: curl -sL <url> | shasum -a 256
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/metro schema --json")
    assert_match "metro.docs.command-reference.v1", output
    ENV["HOME"] = testpath
    assert_match "agent mode: no prompts", shell_output("#{bin}/metro init --agent")
    assert_equal "600", format("%o", File.stat(testpath/".metro/.env").mode & 0o777)
  end
end
