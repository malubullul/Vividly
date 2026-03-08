const { ghibah } = require('./controllers/generateController');
const fs = require('fs');
const path = require('path');

// Mock Express objects
const req = {
    body: {
        text: "Kucing dan Tikus lagi ngobrol di dapur tentang keju",
        avType: "ai",
        format: "drama",
        tone: "kocak"
    }
};

const res = {
    json: (data) => {
        console.log("SUCCESS RESPONSE:");
        console.log(JSON.stringify(data, null, 2));
        process.exit(0);
    },
    status: (code) => ({
        json: (data) => {
            console.log("ERROR RESPONSE:", code);
            console.log(JSON.stringify(data, null, 2));
            process.exit(1);
        }
    })
};

console.log("Testing Ghibah Controller (Demo/Mock Flow)...");
ghibah(req, res).catch(err => {
    console.error("CRASH:", err);
    process.exit(1);
});
