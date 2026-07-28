<p align="center">
  <img src="docs/logo/openwa_logo.webp" alt="Logo de OpenWA" width="220"/>
</p>

<h1 align="center">OpenWA</h1>

<p align="center">
  <strong>Gateway de API de WhatsApp de Código Abierto — Solución Autohospedada, Multi-Sesión y Extensible</strong>
</p>

<p align="center">
  <a href="#-características-principales">Características</a> •
  <a href="#-arquitectura-del-sistema">Arquitectura</a> •
  <a href="#-instalación-y-inicio-rápido">Inicio Rápido</a> •
  <a href="#-configuración-env">Configuración</a> •
  <a href="#-motores-de-whatsapp">Motores</a> •
  <a href="#-referencia-de-la-api-rest">API REST</a> •
  <a href="#-dashboard-interactivo">Dashboard</a> •
  <a href="#-solución-de-problemas">Troubleshooting</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.10.9-blue.svg" alt="Versión"/>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="Licencia"/>
  <img src="https://img.shields.io/badge/node->=22.13-brightgreen.svg" alt="Node.js"/>
  <img src="https://img.shields.io/badge/framework-NestJS_11-red.svg" alt="NestJS"/>
  <img src="https://img.shields.io/badge/frontend-React_19_+_Vite-blueviolet.svg" alt="React"/>
  <img src="https://img.shields.io/badge/docker-ready-blue.svg" alt="Docker"/>
</p>

---

## 📌 Visión General del Proyecto

**OpenWA** es una plataforma autohospedada *(self-hosted)* y de código abierto que actúa como un **Gateway de API REST para WhatsApp**. Permite a desarrolladores, empresas y entusiastas de la automatización enviar y recibir mensajes, gestionar contactos, grupos, webhooks y múltiples cuentas de WhatsApp de forma centralizada y segura sin tarifas por mensaje ni bloqueos de proveedores.

El proyecto está diseñado bajo una **arquitectura basada en adaptadores enchufables** (*pluggable architecture*), lo que permite intercambiar motores de base de datos (SQLite / PostgreSQL), capas de caché (Memoria / Redis), almacenamiento de medios (Local / Amazon S3 / MinIO) y motores de conexión de WhatsApp (Baileys / WhatsApp-Web.js) únicamente mediante variables de entorno.

---

## ✨ Características Principales

### 🚀 Funcionalidades Núcleo
- **API REST Completa**: Endpoints para envío de texto, imágenes, audios, documentos, ubicaciones, contactos, stickers y encuestas.
- **Soporte Multi-Sesión**: Administra decenas de números o cuentas de WhatsApp independientes desde una única instancia.
- **Motores Duales de WhatsApp**:
  - `baileys`: Conexión directa WebSocket rápida, súper liviana (~50MB RAM por sesión) y libre de navegador.
  - `whatsapp-web.js`: Basado en Puppeteer/Chromium headless para máxima compatibilidad visual con WhatsApp Web.
- **Sistema Avanzado de Webhooks**: Notificaciones en tiempo real para eventos de mensajes entrantes, confirmaciones de lectura (*acks*), cambios de estado y eventos de grupo, protegidos con firmas de seguridad HMAC-SHA256.
- **Dashboard Web Moderno**: Interfaz construida con React 19 + Vite para monitorizar sesiones, generar códigos QR de vinculación, probar mensajes en vivo, inspeccionar webhooks y gestionar API Keys.

### 🛡️ Seguridad e Infraestructura
- **Autenticación mediante API Keys**: Protección de endpoints mediante cabeceras `X-API-Key` con restricción opcional de direcciones IP (*whitelisting*).
- **Protocolo MCP (Model Context Protocol)**: Integración nativa con modelos de Inteligencia Artificial y agentes (Cursor, Claude Desktop, Antigravity) para ejecutar herramientas sobre WhatsApp.
- **Integración con n8n y Automatizaciones**: Compatibilidad nativa y nodos comunitarios para workflows en n8n, Chatwoot, Typebot e ioBroker.
- **Arquitectura Sandbox de Plugins (Integration Fabric)**: Extensibilidad de funcionalidades en entornos aislados y seguros.

---

## 🏗️ Arquitectura del Sistema

```
                  ┌──────────────────────────────────────────────┐
                  │              Cliente HTTP / LLM              │
                  │   (Dashboard / cURL / n8n / Agent MCP)      │
                  └──────────────────────┬───────────────────────┘
                                         │  HTTP REST / API Key
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          OpenWA Gateway Backend (NestJS)                        │
│                                                                                 │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────────┐  │
│  │   Controlador REST    │  │  Servicio Webhooks    │  │  Protocolo MCP /    │  │
│  │   & Auth Guard        │  │  (HMAC Signature)     │  │  Integration Fabric │  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └──────────┬──────────┘  │
│              │                          │                         │             │
│              ▼                          ▼                         ▼             │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                        Servicio de Gestión de Sesiones                    │  │
│  └──────────────────────────────────────┬────────────────────────────────────┘  │
│                                         │                                       │
│                                         ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                   Factoría de Adaptadores (Engine Factory)                │  │
│  │                                                                           │  │
│  │      ┌─────────────────────────────┐       ┌───────────────────────────┐  │  │
│  │      │ Adaptador Baileys (WS)      │   ó   │ Adaptador wwebjs (Puppeteer)│  │  │
│  │      └──────────────┬──────────────┘       └─────────────┬─────────────┘  │  │
│  └─────────────────────┼────────────────────────────────────┼────────────────┘  │
└────────────────────────┼────────────────────────────────────┼───────────────────┘
                         │                                    │
                         ▼                                    ▼
         ┌─────────────────────────────┐      ┌─────────────────────────────┐
         │ Red WebSocket (Baileys)     │      │ Instancia Chromium Headless │
         └──────────────┬──────────────┘      └──────────────┬──────────────┘
                        │                                    │
                        └─────────────────┬──────────────────┘
                                          ▼
                             ┌──────────────────────────┐
                             │    Servidores WhatsApp   │
                             └──────────────────────────┘
```

### Tecnologías Empleadas
- **Backend**: Node.js (>=22.13), TypeScript, NestJS 11, TypeORM, Swagger/OpenAPI.
- **Frontend**: React 19, TypeScript, Vite, TanStack Query, Lucide Icons, Recharts.
- **Base de Datos**: SQLite (predeterminado) o PostgreSQL.
- **Caché y Queues**: Redis & BullMQ (opcional).
- **Almacenamiento de Medios**: Local Disk o S3/MinIO.

---

## ⚡ Motores de WhatsApp: Baileys vs WhatsApp-Web.js

OpenWA permite elegir entre dos motores según las necesidades de tu infraestructura:

| Característica | `baileys` (Recomendado) | `whatsapp-web.js` |
| :--- | :--- | :--- |
| **Tecnología** | WebSocket Nativo (Protocolo Baileys) | Chromium Headless (Puppeteer) |
| **Uso de RAM** | 🟢 Muy Bajo (~30MB – 80MB por sesión) | 🔴 Alto (~300MB – 600MB por sesión) |
| **Uso de CPU** | 🟢 Mínimo | 🟡 Moderado |
| **Estabilidad de Sesión**| 🟢 Alta (sin bloqueos de navegador) | 🟡 Susceptible a OOM en baja RAM |
| **Velocidad de Inicio** | ⚡ Ultra rápido (< 3 segundos) | ⏳ 10 - 20 segundos (Carga de navegador) |
| **Uso Ideal** | Producción, alta densidad, VPS con baja RAM | Pruebas visuales, emulación exacta Web |

---

## 🛠️ Guía de Instalación e Inicio Rápido

### Requisitos Previos
- **Node.js**: Versión `22.13.0` o superior.
- **npm**: Versión `10.0.0` o superior.
- **Docker & Docker Compose** *(opcional para despliegue en contenedores)*.

---

### Opción 1: Desarrollo Local (Bare Metal)

1. **Clonar el repositorio**:
   ```bash
   git clone https://github.com/rmyndharis/OpenWA.git
   cd OpenWA
   ```

2. **Instalar dependencias**:
   ```bash
   npm install
   ```

3. **Configurar el archivo de entorno**:
   Copia el archivo de ejemplo `.env.example` a `.env`:
   ```bash
   cp .env.example .env
   ```

4. **Iniciar en modo desarrollo (API + Dashboard en paralelo)**:
   ```bash
   npm run dev
   ```
   - **API REST**: `http://localhost:2785/api/v1`
   - **Swagger Docs**: `http://localhost:2785/api/docs`
   - **Dashboard UI**: `http://localhost:5173`

---

### Opción 2: Despliegue con Docker Compose (Recomendado para Producción)

Para ejecutar la pila completa en producción de forma aislada:

```bash
docker-compose up -d --build
```

Esto iniciará el contenedor de OpenWA expuesto en el puerto `2785`. El dashboard estará integrado directamente en `http://localhost:2785/dashboard`.

---

## ⚙️ Configuración de Variables de Entorno (`.env`)

El archivo `.env` en la raíz gobierna el comportamiento global del sistema. A continuación se detallan las variables más importantes:

```env
# =============================================================================
# CONFIGURACIÓN NÚCLEO
# =============================================================================
NODE_ENV=production
PORT=2785
LOG_LEVEL=info

# Auto-iniciar sesiones autenticadas previamente al encender el servidor (Recomendado true)
AUTO_START_SESSIONS=true

# Límite máximo de sesiones concurrentes (0 = ilimitado)
MAX_CONCURRENT_SESSIONS=0

# =============================================================================
# MOTOR DE WHATSAPP
# =============================================================================
# Opciones: baileys | whatsapp-web.js
ENGINE_TYPE=baileys

# Ruta de almacenamiento de credenciales de sesión
SESSION_DATA_PATH=./data/sessions

# Opciones de Puppeteer (si se usa whatsapp-web.js)
PUPPETEER_HEADLESS=true
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu

# =============================================================================
# BASE DE DATOS Y CACHÉ
# =============================================================================
# Opciones: sqlite | postgres
DATABASE_TYPE=sqlite
DATABASE_SQLITE_PATH=./data/openwa.sqlite

# Configuración Redis (Opcional)
REDIS_ENABLED=false
REDIS_HOST=localhost
REDIS_PORT=6379

# =============================================================================
# SEGURIDAD Y CORS
# =============================================================================
CORS_ORIGINS=*
```

---

## 🛰️ Referencia de la API REST

Todos los endpoints protegidos requieren la cabecera `X-API-Key: tu_clave_api`.

### 1. Gestión de Sesiones (`/api/v1/sessions`)

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/v1/sessions` | Obtener la lista de todas las sesiones registradas. |
| `POST` | `/api/v1/sessions` | Crear e iniciar una nueva sesión de WhatsApp. |
| `GET` | `/api/v1/sessions/:id` | Consultar estado y detalles de una sesión específica. |
| `GET` | `/api/v1/sessions/:id/qr` | Obtener el código QR activo (SVG / Base64 / Raw). |
| `POST` | `/api/v1/sessions/:id/start` | Iniciar una sesión detenida. |
| `POST` | `/api/v1/sessions/:id/stop` | Detener una sesión activa. |
| `DELETE`| `/api/v1/sessions/:id` | Eliminar una sesión y cerrar sesión en WhatsApp. |

#### Ejemplo: Crear una sesión
```bash
curl -X POST http://localhost:2785/api/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_clave_api" \
  -d '{
    "name": "mi-bot",
    "engine": "baileys",
    "autoReconnect": true
  }'
```

---

### 2. Envío de Mensajes (`/api/v1/messages`)

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` | `/api/v1/messages/send-text` | Enviar un mensaje de texto plano. |
| `POST` | `/api/v1/messages/send-media` | Enviar imágenes, audios o documentos por URL/Base64. |
| `POST` | `/api/v1/messages/send-location` | Enviar una ubicación con coordenadas GPS. |
| `POST` | `/api/v1/messages/send-contact` | Enviar una tarjeta vCard de contacto. |
| `POST` | `/api/v1/messages/send-poll` | Enviar una encuesta interactiva con opciones. |
| `POST` | `/api/v1/messages/send-reaction` | Enviar o remover una reacción con emoji. |

#### Ejemplo: Enviar un mensaje de texto
```bash
curl -X POST http://localhost:2785/api/v1/messages/send-text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tu_clave_api" \
  -d '{
    "sessionId": "ID_DE_TU_SESION",
    "to": "5215551234567@c.us",
    "text": "¡Hola desde OpenWA!"
  }'
```

---

### 3. Webhooks (`/api/v1/webhooks`)

Permite suscribir URLs externas para recibir eventos en tiempo real cuando ocurren acciones en WhatsApp:

#### Estructura de Payload de Evento Entrante (`message.create`):
```json
{
  "event": "message.create",
  "timestamp": 1779900000,
  "sessionId": "sess-1234",
  "data": {
    "id": "false_5215551234567@c.us_3EB012345678",
    "from": "5215551234567@c.us",
    "to": "5215559876543@c.us",
    "body": "Hola, necesito información",
    "type": "chat",
    "hasMedia": false
  }
}
```

Cada petición enviada por OpenWA a tu webhook incluye la cabecera `X-OpenWA-Signature` firmada mediante HMAC-SHA256 utilizando el secreto configurado en el webhook para validar autenticidad.

---

## 🖥️ Dashboard Interactivo

El proyecto incluye un dashboard completo accesible desde `/dashboard` que ofrece:

1. **Gestión Visual de Sesiones**: Crea sesiones, visualiza la lectura del código QR en vivo y monitorea el estado (CONECTADO, AUTENTICANDO, DESCONECTADO).
2. **Probador de Mensajes (Message Tester)**: Interfaz de prueba para enviar mensajes de texto y medios en vivo sin escribir código.
3. **Consola de Webhooks**: Registra las entregas de webhooks, prueba envíos de simulación e inspecciona fallos o reintentos.
4. **Administrador de Claves API e Infraestructura**: Controla los servicios auxiliares, bases de datos y configuraciones globales.

---

## 🤖 Integración con IA y Agentes (MCP Protocol)

OpenWA incluye un servidor **MCP (Model Context Protocol)** integrado que expone las capacidades del bot como herramientas para asistentes de IA como Claude Desktop, Cursor o Antigravity.

### Configuración en `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "openwa": {
      "command": "node",
      "args": ["/ruta/a/OpenWA/dist/modules/mcp/mcp-server.js"],
      "env": {
        "OPENWA_API_URL": "http://localhost:2785/api/v1",
        "OPENWA_API_KEY": "tu_clave_api"
      }
    }
  }
}
```

Esto permite que un modelo de lenguaje consulte chats, envíe respuestas por WhatsApp o gestione contactos conversacionalmente.

---

## 🔧 Solución de Problemas Frecuentes (Troubleshooting)

### 1. La sesión de WhatsApp se desconecta o detiene continuamente
- **Causa 1**: `AUTO_START_SESSIONS` está en `false`. Si el servidor se reinicia, las sesiones no se reanudan solas.  
  *Solución*: Configura `AUTO_START_SESSIONS=true` en `.env`.
- **Causa 2**: Consumo excesivo de memoria RAM usando el motor `whatsapp-web.js`.  
  *Solución*: Cambia la variable `ENGINE_TYPE=baileys` en `.env` para usar WebSockets ligeros.
- **Causa 3**: Conflicto de conexión por tener WhatsApp Web abierto en otra pestaña o cliente con la misma cuenta.

### 2. Error en Docker: `Failed to launch the browser process` o Crash de Chromium
- Si utilizas `whatsapp-web.js` en Docker, asegúrate de que las banderas de Puppeteer incluyan `--no-sandbox` y `--disable-dev-shm-usage`:
  ```env
  PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu
  ```

### 3. Pérdida de sesiones tras reiniciar el contenedor Docker
- Asegúrate de montar un volumen persistente para la carpeta `./data` en tu `docker-compose.yml`:
  ```yaml
  volumes:
    - ./data:/app/data
  ```

---

## 🤝 Contribución y Licencia

¡Las contribuciones de la comunidad son bienvenidas! Siente libertad de abrir *Issues* o enviar *Pull Requests*.

- **Licencia**: [MIT License](LICENSE)
- **Autor**: Yudhi Armyndharis y la Comunidad OpenWA.
