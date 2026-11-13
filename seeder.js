const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const MassageShop = require('./models/MassageShop');
const Reservation = require('./models/Reservation');

dotenv.config({ path: './config/config.env' });

const shops = [
    {
        name: 'Baan Sabai Massage',
        address: '123 Phaya Thai Rd, Bangkok',
        tel: '02-111-1111',
        opentime: '10:00',
        closetime: '22:00',
        // Base demo needs up to 3 user queues; Extra Credit Postman sets this to 2 live
        maxReservationsPerDate: 10
    },
    {
        name: 'Lanna Thai Massage',
        address: '45 Chang Klan Rd, Chiang Mai',
        tel: '053-222-2222',
        opentime: '09:00',
        closetime: '21:00',
        maxReservationsPerDate: 10
    },
    {
        name: 'Ocean Spa',
        address: '88 Beach Rd, Phuket',
        tel: '076-333-3333',
        opentime: '11:00',
        closetime: '23:00',
        maxReservationsPerDate: 10
    }
];

const seed = async () => {
    await connectDB();

    if (process.argv[2] === '-d') {
        await Reservation.deleteMany();
        await MassageShop.deleteMany();
        await User.deleteMany();
        console.log('Data destroyed');
        await mongoose.connection.close();
        process.exit(0);
    }

    let admin = await User.findOne({ email: 'admin@gmail.com' });
    if (!admin) {
        admin = await User.create({
            name: 'Admin',
            tel: '02-000-0000',
            email: 'admin@gmail.com',
            password: '12345678',
            role: 'admin'
        });
        console.log('Admin created: admin@gmail.com / 12345678');
    }

    let user = await User.findOne({ email: 'user@gmail.com' });
    if (!user) {
        user = await User.create({
            name: 'Demo User',
            tel: '081-000-0000',
            email: 'user@gmail.com',
            password: '12345678',
            role: 'user'
        });
        console.log('User created: user@gmail.com / 12345678');
    }

    for (const shop of shops) {
        const existing = await MassageShop.findOne({ name: shop.name });
        if (!existing) {
            await MassageShop.create(shop);
            console.log(`Shop created: ${shop.name}`);
        } else {
            // Keep extra-credit cap in sync when re-seeding
            existing.maxReservationsPerDate = shop.maxReservationsPerDate;
            existing.opentime = shop.opentime;
            existing.closetime = shop.closetime;
            await existing.save();
            console.log(`Shop updated: ${shop.name} (max/day=${shop.maxReservationsPerDate})`);
        }
    }

    console.log('Seed complete');
    await mongoose.connection.close();
    process.exit(0);
};

seed().catch((err) => {
    console.log(err);
    process.exit(1);
});
