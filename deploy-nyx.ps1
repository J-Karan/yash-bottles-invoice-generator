param(
  [switch]$Push
)

$ErrorActionPreference = "Stop"

if ($Push) {
  git push
  if ($LASTEXITCODE -ne 0) { throw 'Git push failed.' }
}

$remoteDeploy = @'
set -euo pipefail

repo="/home/ubuntu/ewb-invoice-system-git"
backup_root="/home/ubuntu/ewb-private-backups/masters"
backup="$backup_root/pre-deploy-$(date +%Y%m%d-%H%M%S)"
service_name="ewb-invoice"

buyers_csv="$repo/data/masters/Buyers_Master.csv"
items_csv="$repo/data/masters/Items_Master.csv"
db_file="$repo/data/invoice-app.sqlite"

test -f "$buyers_csv"
test -f "$items_csv"
mkdir -p "$backup"
chmod 700 "$backup"
cp -p "$buyers_csv" "$backup/"
cp -p "$items_csv" "$backup/"

if [ -f "$db_file" ]; then
  sqlite3 "$db_file" ".backup '$backup/invoice-app.sqlite'"
  echo "SQLite database safely backed up to: $backup/invoice-app.sqlite"
fi
if [ -d "$repo/generated" ]; then
  tar -czf "$backup/generated.tar.gz" -C "$repo" generated
fi

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
npm test
sudo systemctl restart "$service_name"
sudo systemctl is-active --quiet "$service_name"
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:5000/api/health

echo "Deployed $(git rev-parse --short HEAD)"
echo "CSV backup: $backup"
'@

$remoteDeploy | ssh nyx "bash -s"
if ($LASTEXITCODE -ne 0) { throw 'Nyx deployment failed. Inspect the service and preserved backup before retrying.' }
