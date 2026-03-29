# Home Assistant Timelapse Package

Automated timelapse creation from Home Assistant dashboard snapshots. Capture hourly, daily, or custom-interval snapshots and automatically generate MP4 videos using FFmpeg.

**Perfect for:**
- Monitoring dashboard activity over time
- Creating plant growth time-lapses
- Monitoring solar generation patterns
- Home automation visualization

---

## Quick Start

### Option 1: Docker (Recommended for Proxmox)

```bash
# Setup
cp .env.example .env
nano .env  # Edit with your HA credentials

# Run
docker-compose up -d
docker-compose logs -f
```

### Option 2: Direct Installation

```bash
sudo chmod +x install.sh
sudo ./install.sh

sudo nano /opt/ha-timelapse/config/.env
sudo systemctl start ha-timelapse.timer
```

### Option 3: Manual Cron Setup

```bash
sudo chmod +x cron-setup.sh
sudo ./cron-setup.sh
```

---

## Features

- ✅ **Automated Snapshots** - Capture at configurable intervals
- ✅ **Scheduled Execution** - Run daily, hourly, or on custom schedule
- ✅ **FFmpeg Integration** - Auto-generates MP4 videos
- ✅ **Portable** - Works on Docker, LXC, VMs, bare metal
- ✅ **Proxmox Ready** - Optimized for Proxmox deployment
- ✅ **Error Handling** - Comprehensive logging and retry logic
- ✅ **Customizable** - Full control over intervals, framerate, duration

---

## Package Contents

```
ha-timelapse/
├── snapshot.mjs              # Core snapshot capture script
├── timelapse.sh              # Main timelapse orchestration script
├── install.sh                # System-level installer (requires sudo)
├── cron-setup.sh             # Alternative cron setup
├── Dockerfile                # Docker container definition
├── docker-compose.yml        # Docker Compose configuration
├── .env.example              # Configuration template
├── README.md                 # This file
└── DEPLOYMENT.md             # Detailed deployment guide
```

---

## Configuration

### Basic Setup

1. **Copy environment template**
   ```bash
   cp .env.example .env
   ```

2. **Get Home Assistant Long-Lived Token**
   - In HA: Profile → Long-lived Access Tokens → Create
   - Copy token to `.env`

3. **Edit `.env`**
   ```bash
   HA_BASE=http://192.168.1.100:8123
   HA_TOKEN=eyJhbGc...
   CAPTURE_INTERVAL=30
   TOTAL_DURATION=3600
   FRAMERATE=30
   ```

### Parameters

| Parameter | Default | Unit | Example |
|-----------|---------|------|---------|
| `HA_BASE` | - | URL | `http://homeassistant.local:8123` |
| `HA_TOKEN` | - | token | `eyJhbGc...` |
| `CAPTURE_INTERVAL` | 30 | seconds | `10, 30, 60, 300` |
| `TOTAL_DURATION` | 3600 | seconds | `1800 (30m), 3600 (1h)` |
| `FRAMERATE` | 30 | fps | `24, 30, 60` |

---

## Deployment

### For Proxmox

**Recommended: Docker in LXC Container**

```bash
# Create Ubuntu 22.04 LXC container
# CPU: 2 cores, RAM: 2GB, Disk: 20GB

# Inside container:
apt update && apt install -y docker.io docker-compose git
git clone <repo> ha-timelapse
cd ha-timelapse
cp .env.example .env
nano .env
docker-compose up -d
```

**For detailed instructions, see [DEPLOYMENT.md](DEPLOYMENT.md)**

---

## Usage

### Docker

```bash
# Start service
docker-compose up -d

# View logs
docker-compose logs -f

# Run manually
docker-compose run --rm ha-timelapse

# Stop
docker-compose down
```

### Direct Installation

```bash
# Start timer
sudo systemctl start ha-timelapse.timer

# View scheduled time
sudo systemctl list-timers ha-timelapse.timer

# View logs
sudo journalctl -u ha-timelapse.service -f

# Run manually
sudo systemctl start ha-timelapse.service
```

### Manual Cron

```bash
# Setup cron
sudo ./cron-setup.sh

# View cron jobs
crontab -l

# Edit cron schedule
crontab -e

# View logs
tail -f /var/log/ha-timelapse.log
```

---

## Scheduling Examples

### Systemd Timer

Edit `/etc/systemd/system/ha-timelapse.timer`:

```ini
# Daily at 2 AM
OnCalendar=*-*-* 02:00:00

# Every 6 hours
OnCalendar=*-*-* 00/6:00:00

# Every hour
OnCalendar=hourly

# Every 30 minutes
OnBootSec=30min
OnUnitActiveSec=30min
```

### Cron

Edit with `crontab -e`:

```bash
# Daily at 2 AM
0 2 * * * /opt/ha-timelapse/run-timelapse.sh

# Every 6 hours
0 0,6,12,18 * * * /opt/ha-timelapse/run-timelapse.sh

# Every hour
0 * * * * /opt/ha-timelapse/run-timelapse.sh

# Every 30 minutes
*/30 * * * * /opt/ha-timelapse/run-timelapse.sh
```

---

## Troubleshooting

### "Cannot connect to Home Assistant"
1. Verify Home Assistant URL: `curl http://192.168.1.100:8123`
2. Check token is valid in HA UI
3. Verify container/system can reach HA network

### "Chrome/Chromium sandbox error"
```bash
# For Docker: Add to Dockerfile
RUN echo 'kernel.unprivileged_userns_clone=1' | tee /etc/sysctl.d/chromium.conf

# For direct install:
echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/chromium.conf
sudo sysctl -p /etc/sysctl.d/chromium.conf
```

### "FFmpeg not found"
```bash
# Docker: Already included
# Direct install:
sudo apt install ffmpeg
```

### View detailed logs
```bash
# Docker
docker-compose logs -f ha-timelapse

# Direct install
sudo journalctl -u ha-timelapse.service -f

# Manual cron
tail -f /var/log/ha-timelapse.log
```

---

## Manual Execution

Test the scripts manually before scheduling:

```bash
# Docker
docker-compose run --rm ha-timelapse

# Direct install
cd /opt/ha-timelapse
./timelapse.sh -i 30 -t 3600 -f 30 \
  -d /tmp/snapshots \
  -o /tmp/timelapse.mp4

# View output
ls -lh /tmp/snapshots/
ls -lh /tmp/timelapse.mp4
```

---

## Performance Tips

### Optimize for Storage
```bash
# Use lower framerate
FRAMERATE=24

# Increase capture interval
CAPTURE_INTERVAL=60

# Reduce total duration
TOTAL_DURATION=1800
```

### Optimize for Speed
```bash
# Increase framerate for smoother video
FRAMERATE=60

# Decrease capture interval for more frames
CAPTURE_INTERVAL=10

# Increase duration for longer timelapses
TOTAL_DURATION=7200
```

---

## Directory Structure

### Docker Volume Mounts
```
/data/
├── snapshots/     # JPEG snapshots
│   ├── snapshot_00001.jpg
│   ├── snapshot_00002.jpg
│   └── ...
└── videos/        # MP4 output files
    ├── timelapse-20240101-020000.mp4
    └── ...
```

### Direct Installation
```
/var/lib/ha-timelapse/
├── snapshots/     # Snapshot storage
└── videos/        # Video output

/opt/ha-timelapse/
├── snapshot.mjs
├── timelapse.sh
├── config/
│   └── .env
└── node_modules/
```

---

## Uninstall

### Docker
```bash
docker-compose down -v
rm -rf /path/to/ha-timelapse
```

### Direct Installation
```bash
sudo systemctl disable ha-timelapse.timer
sudo systemctl stop ha-timelapse.timer
sudo rm /etc/systemd/system/ha-timelapse.*
sudo rm -rf /opt/ha-timelapse
sudo rm -rf /var/lib/ha-timelapse
sudo systemctl daemon-reload
```

### Cron
```bash
crontab -e  # Remove the ha-timelapse line
sudo rm /opt/ha-timelapse/run-timelapse.sh
```

---

## Support

1. Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup instructions
2. Review logs: `journalctl -u ha-timelapse.service -f`
3. Test manually with `sudo systemctl start ha-timelapse.service`
4. Verify Home Assistant is accessible and token is valid

---

## License

MIT License - Free to use and modify

# timelapse-app
