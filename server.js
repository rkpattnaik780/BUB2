#!/usr/bin/env node
const express = require("express");
const next = require("next");
const bodyParser = require("body-parser");
const cors = require("cors");
const compression = require("compression");
require("dotenv").config();
const dev = process.env.NODE_ENV !== "production";
const GB_KEY = process.env.GB_KEY;
const app = next({
  dev
});
const handle = app.getRequestHandler();
var emailaddr = "";
const {
  customFetch
} = require('./utils/helper.js');
const {
  checkForDuplicatesFromIA
} = require('./utils/helper.js');
const {
  checkForPublicDomain
} = require('./controller/GB');
const Arena = require('bull-arena');
const GoogleBooksProducer = require('./bull/google-books-queue/producer');
const PDLProducer = require('./bull/pdl-queue/producer')
const Queue = require('bull');

app
  .prepare()
  .then(() => {
    const server = express();

    //Parse application/x-www-form-urlencoded
    server.use(bodyParser.urlencoded({
      extended: true
    }));

    //Parse application/json
    server.use(bodyParser.json());

    //Enable and use CORS
    server.use(cors({
      credentials: true,
      origin: true
    }));

    server.use(compression());

    const arenaConfig = Arena({
      queues: [{
        // Name of the bull queue, this name must match up exactly with what you've defined in bull.
        name: "pdl-queue",

        // Redis auth.
        redis: {
          port: '6379',
          host: '127.0.0.1',
        },
      }]
    }, {
      // Make the arena dashboard become available at {my-site.com}/arena.
      basePath: '/arena',

      // Let express handle the listening.
      disableListen: true
    });

    server.use(arenaConfig)


    /**
     * Every custom route that we build needs to arrive before the * wildcard.
     * This is necessary because otherwise the server won't recognise the route.
     */

    server.get('/queuedata',async (req,res) => {
      const pdl_queue = await new Queue('pdl-queue').getJobCounts()
      const google_books_queue = await new Queue('google-books-queue').getJobCounts()
      const queryParams = {pdl_queue,google_books_queue}
      res.send(queryParams);
    })

    let GBdetails = {};
    server.get("/check", async (req, res) => {
      const {
        bookid,
        option,
        email
      } = req.query;
      emailaddr = email;
      switch (option) {
        case "gb":
          customFetch(`https://www.googleapis.com/books/v1/volumes/${bookid}?key=${GB_KEY}`, 'GET', new Headers({
            "Content-Type": "application/json"
          }))
            .then(data => {
              const {
                error
              } = checkForPublicDomain(data, res)
              if (!error) {
                GBdetails = data
              }
            });
          break;

        case "pn":
          //Check for duplicates
          const {
            categoryID
          } = req.query;
          res.send({
            error: false,
            message: "You will be mailed with the details soon!"
          });
          PDLProducer(bookid, categoryID, email)
          // const isDuplicate = checkForDuplicatesFromIA(`bub_pn_${bookid}`);
          // isDuplicate.then(resp => {
          //   if (resp.response.numFound != 0) {
          //     res.send({
          //       error: true,
          //       message: "The document already exists on Internet Archive."
          //     })
          //   }
          //   else {

          //   }
          // })
          break;
      }
    });

    server.post("/download", async (req, res) => {
      res.send({
        error: false,
        message: "You will be mailed with the details soon!"
      });

      GoogleBooksProducer(req.body.url, GBdetails, emailaddr);
      // download.downloadFromGoogleBooks(
      //   req.body.url,
      //   GBdetails,
      //   emailaddr
      // );
    });

    /**
     * The express handler for default routes.
     */
    server.get("*", (req, res) => {
      return handle(req, res);
    });

    server.listen(process.env.PORT || 3000, err => {
      if (err) throw err;
      console.log(`> Ready on /:8080`);
    });
  })
  .catch(ex => {
    console.error(ex.stack);
    process.exit(1);
  });