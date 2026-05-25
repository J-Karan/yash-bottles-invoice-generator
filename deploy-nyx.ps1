param(
  [switch]$Push
)

$ErrorActionPreference = "Stop"

if ($Push) {
  git push
}

ssh nyx "/home/ubuntu/deploy-ewb.sh"
