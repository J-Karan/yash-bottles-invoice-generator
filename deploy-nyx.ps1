param(
  [switch]$Push
)

$ErrorActionPreference = "Stop"

if ($Push) {
  git push
}

$remoteDeploy = @'
set -euo pipefail

repo="/home/ubuntu/ewb-invoice-system-git"
backup_root="/home/ubuntu/ewb-private-backups/masters"
backup="$backup_root/pre-deploy-$(date +%Y%m%d-%H%M%S)"
service_name="ewb-invoice"

buyers_csv="$repo/data/masters/Buyers_Master.csv"
items_csv="$repo/data/masters/Items_Master.csv"

test -f "$buyers_csv"
test -f "$items_csv"
mkdir -p "$backup"
cp -p "$buyers_csv" "$backup/"
cp -p "$items_csv" "$backup/"

cd "$repo"
git fetch origin main
git checkout main
git pull --ff-only origin main

mkdir -p "$repo/data/masters"
if [ ! -f "$buyers_csv" ]; then
  cp -p "$backup/Buyers_Master.csv" "$buyers_csv"
fi
if [ ! -f "$items_csv" ]; then
  cp -p "$backup/Items_Master.csv" "$items_csv"
fi

test -f "$buyers_csv"
test -f "$items_csv"

npm ci
npm run build
set -a
. "$repo/.env"
set +a
node --test
sudo systemctl restart "$service_name"
sudo systemctl is-active --quiet "$service_name"

echo "Deployed $(git rev-parse --short HEAD)"
echo "CSV backup: $backup"
'@

$remoteDeploy | ssh nyx "bash -s"
