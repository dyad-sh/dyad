#!/bin/bash
set -e

# Configure PostgreSQL to use md5 for all connections
cat > /var/lib/postgresql/data/pg_hba.conf << 'EOF'
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
host    all             all             0.0.0.0/0               md5
host    all             all             ::/0                    md5
host    replication     all             127.0.0.1/32            md5
host    replication     all             ::1/128                 md5
EOF

# Reload PostgreSQL configuration
pg_ctl reload -D /var/lib/postgresql/data
