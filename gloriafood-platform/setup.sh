#!/bin/bash

# =====================================================
# GloriaFood Platform - Script de Setup Automatizado
# =====================================================

set -e

echo "=========================================="
echo "  GloriaFood Platform - Setup"
echo "=========================================="
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar que wrangler está instalado
if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx no está instalado. Instala Node.js primero.${NC}"
    exit 1
fi

# Paso 1: Instalar dependencias
echo -e "${YELLOW}[1/7] Instalando dependencias...${NC}"
npm install

# Paso 2: Login en Cloudflare
echo ""
echo -e "${YELLOW}[2/7] Iniciando sesión en Cloudflare...${NC}"
echo "Se abrirá el navegador para autenticarte."
npx wrangler login

# Paso 3: Crear base de datos D1
echo ""
echo -e "${YELLOW}[3/7] Creando base de datos D1...${NC}"
D1_OUTPUT=$(npx wrangler d1 create gloriafood-db 2>&1) || true
echo "$D1_OUTPUT"

# Extraer el database_id
D1_ID=$(echo "$D1_OUTPUT" | grep -oP 'database_id = "\K[^"]+' || echo "")

if [ -z "$D1_ID" ]; then
    echo -e "${YELLOW}La base de datos puede ya existir. Obteniendo ID...${NC}"
    D1_ID=$(npx wrangler d1 list | grep gloriafood-db | awk '{print $1}' || echo "")
fi

echo -e "${GREEN}Database ID: $D1_ID${NC}"

# Paso 4: Crear KV namespace
echo ""
echo -e "${YELLOW}[4/7] Creando KV namespace...${NC}"
KV_OUTPUT=$(npx wrangler kv:namespace create CACHE 2>&1) || true
echo "$KV_OUTPUT"

# Extraer el KV id
KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "\K[^"]+' || echo "")

if [ -z "$KV_ID" ]; then
    echo -e "${YELLOW}El KV puede ya existir. Obteniendo ID...${NC}"
    KV_ID=$(npx wrangler kv:namespace list | grep -A1 "gloriafood-platform-CACHE" | grep "id" | awk -F'"' '{print $2}' || echo "")
fi

echo -e "${GREEN}KV ID: $KV_ID${NC}"

# Paso 5: Actualizar wrangler.toml
echo ""
echo -e "${YELLOW}[5/7] Actualizando wrangler.toml...${NC}"

if [ -n "$D1_ID" ]; then
    sed -i "s/database_id = \"YOUR_DATABASE_ID\"/database_id = \"$D1_ID\"/" wrangler.toml
    sed -i "s/database_id = \".*\"/database_id = \"$D1_ID\"/" wrangler.toml
fi

if [ -n "$KV_ID" ]; then
    sed -i "s/id = \"YOUR_KV_ID\"/id = \"$KV_ID\"/" wrangler.toml
fi

echo -e "${GREEN}wrangler.toml actualizado${NC}"

# Paso 6: Ejecutar migraciones
echo ""
echo -e "${YELLOW}[6/7] Ejecutando migraciones de base de datos...${NC}"
npx wrangler d1 execute gloriafood-db --remote --file=./schema/migrations.sql

echo -e "${GREEN}Migraciones completadas${NC}"

# Paso 7: Configurar secrets
echo ""
echo -e "${YELLOW}[7/7] Configurando secrets...${NC}"
echo ""

echo "Ingresa el GLORIAFOOD_MASTER_KEY (de GloriaFood):"
read -s MASTER_KEY
echo "$MASTER_KEY" | npx wrangler secret put GLORIAFOOD_MASTER_KEY

echo ""
echo "Ingresa un API_AUTH_TOKEN (inventa uno para proteger tu API):"
read -s API_TOKEN
echo "$API_TOKEN" | npx wrangler secret put API_AUTH_TOKEN

# Desplegar
echo ""
echo -e "${YELLOW}Desplegando Worker...${NC}"
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"

# Extraer URL
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oP 'https://[a-zA-Z0-9-]+\.workers\.dev' | head -1)

echo ""
echo "=========================================="
echo -e "${GREEN}  ¡Despliegue completado!${NC}"
echo "=========================================="
echo ""
echo -e "Worker URL: ${GREEN}$WORKER_URL${NC}"
echo ""
echo "Configura en GloriaFood:"
echo -e "  Endpoint URL: ${GREEN}${WORKER_URL}/webhook/orders${NC}"
echo ""
echo "Configura en el Dashboard:"
echo -e "  URL del API: ${GREEN}$WORKER_URL${NC}"
echo -e "  API Token: ${GREEN}(el que ingresaste arriba)${NC}"
echo ""
