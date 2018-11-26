const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Random = require('../utils/random.js');
const { createToken } = require('../utils/encrypt.js');
const { admin_users } = require('./db-connection').collections();
const ObjectId = require('mongodb').ObjectID;
const fs = require('fs');
const { verifyToken } = require('../utils/user-utils');

const USER_TYPES = {
    CUSTOMER: 0,
    CLIENT: 1
};

class AdminUsers {
    /**
     * 
     * @param {Response} res 
     * @param {string} email
     * 
     * @desc Checks email address to make sure it doesn't already exist 
     */
    checkEmail(res, email) {
        if(!email){
            return res.sendStatus(400);
        }

        if(!this.verifyEmail(email)) {
            return res.sendStatus(500);
        }

        admin_users.findOne({email: email}).then(user => {
            if(user){
                res.send({status: "taken"});
            } else {
                res.send({status: "ok"});
            }
        }).catch(e => {
            console.error(e);
            res.sendStatus(500);
        });
    }

    /**
     * 
     * @param {string} email
     * 
     * @desc ensures that email fits format name@email.com or any other domain as long as x@x.xx condition is met
     */
    verifyEmail(email){
        return email.match(/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
    }

    /**
     * 
     * @param {string} password
     * 
     * @desc uses several regex checks to ensure that the password meets minimum requirements
     */
    checkPassword(password){
        //check length
        if(password.length < 10){
            return false;
        }

        //check for special char
        if(!password.match(/[!@#$%^&*(),.?":{}|<>]/g)) {
            return false;
        }

        //check for capital
        if(!password.match(/[A-Z]/g)){
            return false;
        }

        //check for lowercase
        if(!password.match(/[a-z]/g)){
            return false;
        }

        //check for uppercase
        if(!password.match(/[0-9]/g)) {
            return false;
        }

        return true;
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} email 
     * @param {string} password 
     * @param {string} phone 
     * @param {string} first_name 
     * @param {string} last_name 
     * 
     * @desc inserts new admin user into the database - can only be created by another admin, admins can't sign themselves up
     */
    createNew(res, token, email, password, phone, first_name, last_name){
        let user = verifyToken(token);
        if(!user || !(user && user.is_super_admin)) return res.sendStatus(400);

        
        //all fields required - if some fields are not required, remove param from this check
        if(!email || !password || !phone || !first_name || !last_name) {
            return res.sendStatus(400);
        }

        console.log(email, password, phone, first_name, last_name);

        if(!this.verifyEmail(email)) {
            return res.send({status: "bad email"});
        }

        if(!this.checkPassword(password)) {
            return res.send({status: "bad password"});
        }

        admin_users.findOne({email: email}).then(user => {
            if(user){
                return res.send({status: "taken"});
            }

            bcrypt.genSalt(10, (err, salt) => {
                if(err){
                    return res.sendStatus(500);
                }
                bcrypt.hash(password, salt, (err, hash) => {
                    if(err){
                        //log error
                        console.error(err);
                        res.sendStatus(500);
                    } else {
                        //text msg random num
                        let random = Random(32);
    
                        admin_users.insertOne({
                            email: email,
                            password: hash,
                            profile: {
                                phone: phone,
                                first_name: first_name,
                                last_name: last_name,
                            },
                            verification_code: random,
                            verified: 0,
                            enabled: 1,
                            is_super_admin: true,
                            force_password_refresh: true,
                            created: new Date(),
                            modified: new Date()
                        }, (err, inserted) => {
                            if(err){
                                console.error(err);
                                return res.sendStatus(500);
                            }

                            this.sendAdminEmail(inserted.insertedId, random, email);
                            res.sendStatus(200);
                        });
                    }
                });
            });
        });
    }

    sendAdminEmail(id, code, email) {
        //TODO: send verification email with link to verify admin email and reset password
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} token 
     * 
     * @desc Passes token from front-end to retrieve a new token, used for resuming sessions or refreshing user data on profile change
     */
    refreshUser(res, token) {
        let user = verifyToken(token);
        if(!user) return res.sendStatus(400);

        admin_users.findOne({_id: ObjectId(user._id)}).then(result => {
            if(result) {
                delete result.password;
                res.send(createToken(result));
            } else {
                console.error(__error, "user not found");
                res.sendStatus(500);
            }
        }).catch(e => {
            console.error(__error, e);
            res.sendStatus(500);
        });
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} hash 
     * 
     * @desc Checks verification code from query string, sends corresponding html page depending on success
     */
    verify(res, hash){
        admin_users.findOne({verification_code: hash, verified: 0}).then(result => {
            if(result){
                admin_users.updateOne({phone: phone, verification_code: code}, {$set: {verified: 1, modified: new Date()}}, (err, success) => {
                    if(err){
                        console.error(err);
                        res.send(fs.readFileSync("../views/verification-failure.html", "utf8"));
                    } else {
                        //TODO: CREATE ADMIN SET PAGE TO FORCE ADMIN TO RESET PASSWORD
                        res.redirect('http://localhost:3000/set-admin-password');
                    }
                });
            } else {
                res.send(fs.readFileSync("../views/verification-failure.html", "utf8"));
            }
        }).catch(e => {
            console.error(e);
        });
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} email 
     * 
     * @desc sets a new verification code and emails code to the user
     */
    requestNewCode(res, email){
        admin_users.findOne({email: email}).then(result => {
            if(result){
                let random = Random(32);

                //TODO: send message to phone
                admin_users.updateOne({_id: ObjectId(result._id)}, {$set: {verification_code: random, modified: new Date()}}, (err, updated) => {
                    if(err){
                        console.error(__error, err);
                        res.sendStatus(500);
                    } else {
                        res.sendStatus(200);
                        //TODO: send verification email again
                    }
                });
            } else {
                res.status(500).send({message: "unknown email"});
            }
        });
    }

    verificationFailed(email){
        //TODO: send error message
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} email 
     * @param {string} password
     * 
     * @desc checks email and password, if success, sends token, if failure, sends error message 
     */
    signIn(res, email, password) {
        admin_users.findOne({email: email}).then(user => {
            console.log(user);
            if(!user || user.enabled === 0){
                return res.send({error: "email not recognized"});
            }

            if(user.verified === 0){
                return res.send({error: "Account unverified"});
            }

            if(user.force_password_refresh) {
                return res.send({error: "Password expired. Please update password."});
            }

            bcrypt.compare(password, user.password, (err, success) => {
                if(err){
                    console.error(err);
                    return res.send({error: "Password could not be verified"});
                }

                if(!success){
                    return res.send({error: "Incorrect password"});
                } else {

                    console.log({
                        email: user.email,
                        profile: user.profile,
                        _id: user._id
                    });

                    //should send to front-end more params than this
                    let token = createToken({
                        email: user.email,
                        profile: user.profile,
                        _id: user._id
                    });

                    res.send({token: token});
                }
            })
        }).catch(e => {
            console.error(e);
            return res.sendStatus(500);
        });
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} email
     * 
     * @desc allows forced verification for email - should be disabled in production 
     */
    forceVerify(res, email) {
        admin_users.updateOne({email: email}, {$set: {verified: 1, modified: new Date()}}, (err, success) => {
            if(err){
                res.sendStatus(404);
            } else {
                res.sendStatus(200);
            }
        });
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} token 
     * @param {string} oldPassword 
     * @param {string} newPassword 
     * 
     * @desc allows user to change password providing current token, provided old password, and new password
     * 
     */
    changePassword(res, token, oldPassword, newPassword) {
        let user = verifyToken(token);
        if(!user) return res.sendStatus(400);

        admin_users.findOne({_id: ObjectId(user._id)}).then(userRecord => {
            console.log(userRecord);
            if(!userRecord || userRecord.enabled === 0){
                return res.send({error: "email not recognized"});
            }

            bcrypt.compare(oldPassword, userRecord.password, (err, success) => {
                if(err){
                    console.error(__error, err);
                    return res.send({error: "Password could not be verified"});
                }

                if(!success){
                    return res.send({error: "Incorrect password"});
                } else {

                    bcrypt.genSalt(10, (err, salt) => {
                        if(err){
                            return res.sendStatus(500);
                        }
                        bcrypt.hash(newPassword, salt, (err, hash) => {
                            if(err){
                                //log error
                                console.error(err);
                                res.sendStatus(500);
                            } else {
                                admin_users.updateOne({_id: ObjectId(userRecord._id)}, {$set: {password: hash, modified: new Date()}}, (err, updated) => {
                                    if(err){
                                        console.error(__error, err);
                                        return res.sendStatus(500);
                                    }
        
                                    delete userRecord.password;
                                    res.send({token: createToken(userRecord)});
                                });
                            }
                        });
                    });
                }
            })
        }).catch(e => {
            console.error(e);
            return res.sendStatus(500);
        });
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} email
     * 
     * @desc sends forgot password email to user's email address with new verification code
     */
    forgotPassword(res, email) {
        if(this.verifyEmail(email)){
            admin_users.findOne({email: email}).then(user => {
                let random = Random(32);
                admin_users.updateOne({_id: ObjectId(user._id)}, {$set: {verification_code: random, modified: new Date()}}, (err, updated) => {
                    if(err) {
                        console.error(__error, err);
                        res.sendStatus(500);
                    } else {
                        res.sendStatus(200);
                        //TODO: send email with new code
                    }
                });
            });
        }
    }

    /**
     * 
     * @param {Response} res 
     * @param {string} code 
     * @param {string} newPassword 
     * 
     * @desc allows password to be reset by user by checking that the verification code received matches a user account
     */
    resetPassword(res, code, newPassword) {
        admin_users.findOne({verification_code: code}).then(user => {
            if(user) {
                bcrypt.genSalt(10, (err, salt) => {
                    if(err){
                        return res.sendStatus(500);
                    }
                    bcrypt.hash(newPassword, salt, (err, hash) => {
                        if(err){
                            //log error
                            console.error(__error, err);
                            res.sendStatus(500);
                        } else {
                            admin_users.updateOne({_id: ObjectId(user._id)}, {$set: {password: hash, modified: new Date()}}, (err, updated) => {
                                if(err){
                                    console.error(__error, err);
                                    return res.sendStatus(500);
                                }
    
                                delete user.password;
                                res.send({token: createToken(user)});
                            });
                        }
                    });
                });
            }
        });
    }

    updateProfile(res, token, profile) {
        let user = verifyToken(token);
        if(!user) return res.sendStatus(400);

        admin_users.updateOne({_id: ObjectId(user._id)}, {$set: {profile: profile}}, (err, updated) => {
            if(err) {
                console.error(__error, err);
                res.sendStatus(500);
            } else {
                res.sendStatus(200);
            }
        });
    }

    signOut(res, email){
        /**
         * 
         * Probably just remove token from front-end, but if we create a mobile app
         * we might need to deassociate the account from the device for push notifications
         * 
         */
    }

    disable(res, token){

    }

    decodeToken(res, token) {
        let user = verifyToken(token);
        res.send(user);
    }
}

module.exports = new AdminUsers();