# Gathering Globe

**Contributors:** Thang Nguyen (Lead), Quan Nguyen, Quynh Tran, Phuong Le

An event management platform that supports local and small artists with tools to create and manage events, sell tickets, and foster community engagement.

## User Stories

### Artist/Event/Business Organizer
- **Profile Management**: Create and customize artist profile with bio, portfolio, and contact information
- **Event Creation**: Post new events with details, dates, venue, and ticket pricing
- **Event Management**: Edit event information, update descriptions, and modify schedules
- **Ticket Sales**: Set ticket prices, manage inventory, and monitor sales analytics
- **Ticket Resale**: Enable ticket resale functionality
- **Discount Management**: Create and apply discount codes to boost ticket sales
- **Seat Management**: Track remaining seats and update availability in real-time
- **Live Streaming**: Broadcast events live to remote audiences using OBS integration
- **Payment Processing**: Receive payments securely through Stripe integration

### Attendee
- **Event Discovery**: Browse and search for local events by location, date, or artist
- **Ticket Purchase**: Buy tickets with secure payment processing and email confirmation
- **QR Code Access**: Receive digital tickets with QR codes for event entry
- **Profile Creation**: Create user accounts to track purchases and favorite events
- **Live Stream Viewing**: Watch live-streamed events from home
- **Community Chat**: Interact with other attendees through real-time chat
- **AI Assistance**: Get help navigating the platform through the AI chatbot
- **Location Services**: Find event venues using integrated Google Maps

## Tech Stack

**Frontend:**
- React 18 with TypeScript
- Vite
- TailwindCSS
- Shadcn UI components

**Backend:**
- Node.js with Express
- TypeScript
- MongoDB with Mongoose
- Socket.io for real-time chat
- Livekit for streaming
- JWT authentication

**External Services:**
- Stripe for payments
- Google Maps API
- OpenAI GPT
- Cloudinary for media storage
- Uploadthing for file uploads

## Project Structure

```
GatheringGlobe/
├── frontend/                    # React TypeScript frontend
│   ├── src/
│   │   ├── components/          # UI components
│   │   │   ├── aboutUs/
│   │   │   │   └── featuresComponent.tsx
│   │   │   ├── checkout/
│   │   │   ├── homepage/
│   │   │   │   ├── footer.tsx
│   │   │   │   └── pageheader.tsx
│   │   │   ├── loginPage/
│   │   │   │   └── loginPage.tsx
│   │   │   ├── navbar/
│   │   │   ├── toolbar.tsx      # Text editor toolbar
│   │   │   └── ui/              # Shadcn components
│   │   ├── services/            # API services
│   │   ├── hooks/               # Custom hooks
│   │   ├── utils/
│   │   └── images/              # Static assets
│   ├── public/
│   ├── components.json          # Shadcn config
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── package.json
├── backend/                     # Node.js Express backend
│   ├── src/
│   │   ├── controllers/
│   │   │   └── forget_reset_Password.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── rateLimit.ts
│   │   ├── models/              # MongoDB schemas
│   │   │   ├── user.ts
│   │   │   ├── event.ts
│   │   │   ├── order.ts
│   │   │   ├── stream.ts
│   │   │   ├── block.ts
│   │   │   └── discount.ts
│   │   ├── routes/              # API endpoints
│   │   │   ├── auth.ts
│   │   │   ├── events.ts
│   │   │   ├── payments.ts
│   │   │   ├── orders.ts
│   │   │   ├── oauth.ts         # Google OAuth
│   │   │   ├── request.ts       # OAuth requests
│   │   │   ├── livekit.ts       # Streaming
│   │   │   ├── chatbot.ts       # AI chatbot
│   │   │   ├── discounts.ts
│   │   │   └── block.ts
│   │   ├── utils/
│   │   │   └── constants/
│   │   │       └── event-data.ts # SEO URLs
│   │   ├── validators/          # Input validation
│   │   ├── types/               # TypeScript definitions
│   │   ├── seed/                # Database seeding
│   │   ├── uploadthing.ts       # File upload config
│   │   └── index.ts             # Server entry point
│   ├── tsconfig.json
│   └── package.json
├── package.json                 # Root package file
└── README.md
```

## Environment Variables

### Backend `.env` (`/backend/.env`):
```env
# Database
MONGODB_CONNECTION_STRING=mongodb://localhost:27017/gatheringglobe

# Authentication
JWT_SECRET_KEY=your_jwt_secret_key
USER_EMAIL=your_email@gmail.com
USER_PASSWORD=your_email_password

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Google OAuth
CLIENT_ID=your_google_client_id
CLIENT_SECRET=your_google_client_secret

# Payment
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# AI Chatbot
OPENAI_API_KEY=your_openai_api_key

# Maps
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Media Storage
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# File Uploads
UPLOADTHING_SECRET=your_uploadthing_secret
UPLOADTHING_APP_ID=your_uploadthing_app_id

# Live Streaming
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_WS_URL=wss://your-livekit-server.com

# Server
PORT=5050
NODE_ENV=development
```

### Frontend `.env` (`/frontend/.env`):
```env
VITE_API_BASE_URL=http://localhost:5050
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
VITE_UPLOADTHING_APP_ID=your_uploadthing_app_id
```

## Local Development Setup

### Prerequisites
- Node.js 18+
- MongoDB
- Stripe account
- Google Cloud Console project (OAuth + Maps)
- OpenAI API key
- Cloudinary account
- Livekit server
- Uploadthing account

### Installation

1. **Clone repository**
```bash
git clone <repository-url>
cd GatheringGlobe
```

2. **Install dependencies**
```bash
# Root dependencies
npm install

# Install all (frontend + backend)
npm run setup
```

3. **Create environment files**
```bash
# Backend environment
touch backend/.env
# Add all backend environment variables

# Frontend environment
touch frontend/.env
# Add all frontend environment variables
```

4. **Start development servers**
```bash
# Start both frontend and backend
npm run dev

# Or start individually:
# Backend only
npm run dev:back

# Frontend only  
npm run dev:front
```

## Access Points

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5050

## Core Features

- **Event Management**: Create, edit, and manage events
- **Ticket Sales**: Stripe integration for payments
- **Live Streaming**: Livekit integration with OBS support
- **Real-time Chat**: Socket.io powered messaging
- **QR Code Ticketing**: Digital ticket validation
- **AI Chatbot**: OpenAI GPT for user assistance
- **Google Maps**: Location search and display
- **User Authentication**: JWT with Google OAuth
- **Media Upload**: Cloudinary and Uploadthing integration

## API Endpoints

- `POST /api/users/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/events` - Get events
- `POST /api/events` - Create event
- `POST /api/payments` - Process payment
- `GET /api/orders` - Get orders
- `POST /api/request` - OAuth request
- `POST /api/oauth` - OAuth callback
- `POST /api/livekit/*` - Streaming endpoints
- `POST /api/chatbot` - AI chatbot
- `POST /api/webhooks/livekit` - Livekit webhooks

## Scripts

```bash
# Development
npm run dev              # Start frontend + backend
npm run dev:front        # Frontend only
npm run dev:back         # Backend only

# Setup
npm run setup            # Install all dependencies
npm run install:client   # Install frontend deps
npm run install:server   # Install backend deps

# Linting
npm run lint:frontend    # Format frontend code
```

## Database Schema

Key models include:
- **User**: Authentication and profile data
- **Event**: Event details and metadata
- **Order**: Purchase transactions
- **Stream**: Live streaming sessions
- **Block**: User blocking system
- **Discount**: Promotional codes