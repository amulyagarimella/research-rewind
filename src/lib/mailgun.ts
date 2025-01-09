import formData from 'form-data';
import Mailgun from 'mailgun.js';
const mailgun = new Mailgun(formData);

if (!process.env.MAILGUN_API_KEY) {
	throw new Error('MAILGUN_API_KEY is not defined');
}

const mg = mailgun.client({username: 'api', key: process.env.MAILGUN_API_KEY});

export { mg };