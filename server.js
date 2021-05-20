if (process.env.NODE_ENV !== 'production'){
    require('dotenv').config()
}
let port = process.env.PORT || 5000;
const express = require('express')
const passport = require('passport')
const app = express()
const flash = require('express-flash')
const session = require('express-session')
const bcrypt = require('bcrypt')
const meth_override = require('method-override')
const body_parser = require('body-parser')
const mongoose = require('mongoose')
const rand_gen = require('./scripts/rand-generator')
mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true,useUnifiedTopology: true,useFindAndModify:false})
const testing = process.env.TEST_DEMO
if(testing==='true')
    console.log('TEST MODE ENABLED')

const db = mongoose.connection
db.on('error', error => console.error(error))
db.once('open', () => console.log("Connected to mongo"))

const users = require('./schemas/user')
const room = require('./schemas/room')
var no_of_rooms
room.countDocuments({}, function (err, count){
    if (err) console.log(err)
    else{
        no_of_rooms=count
        rand_gen.generator(no_of_rooms)
    }
})

const init_pass = require('./pass-config')
const { temp_check } = require('./scripts/check-safety')
const user = require('./schemas/user')
init_pass(
    passport
)

app.set('view-engine', 'ejs')
app.use(express.urlencoded({extended: false}))
app.use(flash())
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

}))
app.use(express.static(__dirname + '/views'))
app.use(meth_override('_method'))
app.use(body_parser.urlencoded({ limit: '10mb', extended: false }))
app.use(body_parser.json())

app.use(passport.initialize())
app.use(passport.session())

app.get('/', (req, res) => {
    res.render('index.ejs')
})

app.get('/login', check_not_auth, (req, res) => {
    rand_gen.generator(no_of_rooms)
    res.render('login.ejs')
})

app.get('/dashboard', check_auth, async (req, res) => {
    let getUser = await req.user
    let getRoom = await room.findOne({room_id: getUser.room_id})
    res.render('dashboard.ejs',{
        "room" : getRoom,
        "user" : getUser
    })
})

app.get('/admin_dashboard', check_auth_admin,async(req, res) => {
    let getRooms = await room.find();
    no_of_rooms = getRooms.length;
    let getUsers = await users.find();
    let no_of_users = getRooms.length;
    let room_ids = [];
    let room_users = [];
    let room_temps = [];
    let thermostats = [];
    let max_temps = [];
    let min_temps = [];
    let email_ids = [];
    let mob_nos = [];
    let names = [];

    for(let i=0;i<no_of_rooms;i++){
        room_ids[i] = getRooms[i].room_id;
        room_temps[i] = getRooms[i].temperature;
        room_users[i] =  getRooms[i].user_id;
        thermostats[i] = getRooms[i].thermostat;
        max_temps[i] =  getRooms[i].alarm_temp[1];
        min_temps[i] =  getRooms[i].alarm_temp[0];
    }
    for(let i=0;i<no_of_users;i++){
        email_ids[i] = getUsers[i].email;
        names[i] = getUsers[i].first_name + ' ' + getUsers[i].last_name;
        mob_nos[i] = getUsers[i].phone_nos;

    }
    res.render('admin_dashboard.ejs',{
            "rooms" : getRooms,
            "roomid" : room_ids,
            "room_user" : room_users,
            "room_temp" : room_temps,
            "thermostat": thermostats,
            "max_temp" : max_temps,
            "min_temp" : min_temps,
            "email" : email_ids,
            "name" : names,
            "mobno" : mob_nos,
            "errorMessage" : ''
        });
});

app.post('/login', check_not_auth, passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true,

}))

app.post('/new_user', async (req, res) => {
    let isadmin = false
    let isEC = false
    if(req.body.admin==='1'){
        isadmin=true
        isEC = true
    }

    if(req.body.mobno.length>10||req.body.mobno.length<10){
        if(testing === 'true')
            console.log('phone number not valid')
        res.render('new_user.ejs', {errorMessage: 'Phone number is not valid'})
    }

    var password 
    try {
        password = await bcrypt.hash(req.body.mobno, 10)
    } catch {
        console.log('failed to hash password')
    }
    const user = new users({
        _id: req.body.uname,
        first_name: req.body.firstname,
        last_name: req.body.lastname,
        email: req.body.email,
        pwd: password,
        admin: isadmin,
        emergency_contact: isEC,
        phone_nos: req.body.mobno,
        room_id: no_of_rooms+1,
    })
    
    if(testing==='true'){
        console.log('new user created: ')
        console.log(user)
        res.redirect('/admin_dashboard')
        return
    }

    user.save(async (err, newUser) => {
        if (err) {
            if(testing==='true')
                console.log('user already exists')
            res.render('new_user.ejs', {user: user, errorMessage:'Please make sure that all fields are entered correctly and that the user does not already exist'})
            console.log(err)
        } else {
            no_of_rooms++
            try {
                let temp = Math.floor(Math.random()*25)+15
                let thermo_temp = temp + (Math.floor(Math.random()*3) * (Math.round(Math.random())?1:-1))
                await room.findOneAndUpdate(
                    {
                        room_id: no_of_rooms
                    },
                    {
                        room_id: no_of_rooms,
                        temperature: temp,
                        alarm_temp: [15,40],
                        thermostat: thermo_temp,
                        safe: true,
                        residential: true,
                        occupied: true,
                        user_id: req.body.uname
                    },
                    {
                        upsert: true
                    }
                )
            } catch {
                console.log('error generating room info')
            }
            res.redirect('/admin_dashboard')
        }
    })
})

app.post('/admin_dashboard', async (req, res) => {
    update_room_info(req.body)
})

app.post('/dashboard', async (req, res) => {
    update_room_info(req.body)
})

app.get('/new_user', check_auth_admin, (req, res) => {
    res.render('new_user.ejs', { user: new users(), errorMessage:''})
})

app.delete('/logout', (req,res) => {
    req.logOut()
    res.redirect('/login')
})

async function check_auth(req, res, next){
    const our_user = await req.user
    if (req.isAuthenticated()){
        if (our_user.admin){
            return res.redirect('/admin_dashboard')
        }
        return next()
    }

    res.redirect('/login')
}

async function check_auth_admin(req, res, next){
    const our_user = await req.user
    if (req.isAuthenticated()){
        if (!our_user.admin){
            return res.redirect('/login')
        }
        return next()
    }

    res.redirect('/login')
}

function check_not_auth(req, res, next){
    if (req.isAuthenticated()){
        
        return res.redirect('/dashboard')
    }

    next()
}

async function update_room_info(new_info){
    let userreq = new_info[2]
    let new_thermo = new_info[4]
    let new_res = [new_info[5], new_info[6]]
    let pno = new_info[3]
    if(pno.length>10||pno.length<10){
        console.log('not a valid phone number')
    }
    let name = new_info[1].split(' ')
    let fname = name[0]
    name.shift()
    let lname = ''
    if (name.length!=0)
        lname = name.join(' ')
    if (new_res[0]>new_res[1] || (new_res[1]-new_res[0])<15){
        console.log('min temp more than max temp or difference less than 15')
        return
    }
    var useridreq
    try {
        useridreq = await users.findOne({email: userreq})
    } catch {
        console.log('error getting user')
    }

    if(testing==='true'){
        console.log('id:', userreq, '\nnew thermostat temp:', new_thermo, '\nnew acceptable temps:', new_res, '\nfirst name:', fname, '\nlast name:', lname, '\nphone number:', pno, '\nroom number:', useridreq.room_id)
        return
    }

    if (!useridreq){
        console.log('error updating info user id not valid')
        return
    }
    else {
        try {
            await room.findOneAndUpdate(
                {
                    user_id: useridreq._id
                },
                {
                    thermostat: new_thermo,
                    alarm_temp: new_res
                },
                {
                    upsert: false
                }
            )
            await user.findOneAndUpdate(
                {
                    _id: useridreq._id
                },
                {
                    first_name: fname,
                    last_name: lname,
                    phone_nos: pno
                },
                {
                    upsert: false
                }
            )
        } catch {
            console.log('error updating info')
        }
    }

    return
}

app.listen(port)