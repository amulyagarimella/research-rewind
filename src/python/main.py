import firebase_admin
from firebase_admin import credentials, db

cred = credentials.Certificate('lib/old-nature-firebase-adminsdk-dgskn-983c7aa8a2.json')
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://old-nature.firebaseio.com'
})

