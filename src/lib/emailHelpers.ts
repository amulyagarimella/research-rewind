import crypto from 'crypto';

export function generateUnsubscribeToken(email:string) {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    return crypto.createHash('sha256').update(`${email}${secret}`).digest('hex');
}

export const feedbackLink="https://tally.so/r/3X10Y4"

export function generateHTMLLink(link:string, text:string) {
    return "<a href=\"" + link + "\"  target=\"_blank\" rel=\"noopener noreferrer\">" + text + "</a>";
}

export const getBaseUrl = () => {
    if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") {
        return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    } else if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview") {
        return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
    }
    return "http://localhost:3000";
};