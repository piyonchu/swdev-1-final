# Massage Reservation API

REST API for Project #8: Massage Reservation. Same stack as Assignment 7 (Express + MongoDB + JWT), reworked for massage shops and queues.

## Setup

```bash
npm install
cp config/config.env.example config/config.env
# set MONGO_URI (local MongoDB or Atlas) and JWT_SECRET
npm run seed
npm run dev
```

Server: `http://localhost:5000`

Demo accounts after seed:

- admin: `admin@gmail.com` / `12345678`
- user: `user@gmail.com` / `12345678`

Import `postman/Massage-Reservation.postman_collection.json` and set collection variable `token` from login/register.

## Endpoints

Auth (public except `/me`):

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Register with name, tel, email, password |
| POST | `/api/v1/auth/login` | Login with email, password |
| GET | `/api/v1/auth/logout` | Clear auth cookie |
| GET | `/api/v1/auth/me` | Current user (Bearer token) |

Massage shops (login required; write = admin):

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/massage-shops` | Shop list (name, address, tel, open-close) |
| GET | `/api/v1/massage-shops/:id` | One shop |
| POST | `/api/v1/massage-shops` | Create shop (admin) |
| PUT | `/api/v1/massage-shops/:id` | Edit shop (admin) |
| DELETE | `/api/v1/massage-shops/:id` | Delete shop (admin) |

Reservations (login required; users cap at 3 queues):

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/massage-shops/:id/reservations` | Reserve a queue (`date`) |
| GET | `/api/v1/reservations` | Own queues; admin sees all |
| GET | `/api/v1/reservations/:id` | One reservation |
| PUT | `/api/v1/reservations/:id` | Edit own / any if admin |
| DELETE | `/api/v1/reservations/:id` | Delete own / any if admin |

Header: `Authorization: Bearer <token>`
