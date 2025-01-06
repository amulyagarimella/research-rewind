import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
    // Your email service configuration
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_ADDRESS,
        pass: process.env.EMAIL_PASSWORD
    }
});

export { transporter };