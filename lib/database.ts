import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI!;
const options = {};
if (!uri) throw new Error('MONGODB_URI 환경변수가 설정되지 않았습니다.');

let client = new MongoClient(uri, options);
let clientPromise: Promise<MongoClient>;

declare global {
	var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === 'development') {
	if (!global._mongoClientPromise) {
		global._mongoClientPromise = client.connect();
	}
	clientPromise = global._mongoClientPromise;
} else {
	clientPromise = client.connect();
}

export default clientPromise;
