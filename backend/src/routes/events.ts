import express, { Request, Response } from "express";
import verifyToken from "../middleware/auth";
import User from "../models/user";
import Event, { EventType } from "../models/event"; // this is the model <-------
import Ticket from "../models/ticket";
import mongoose from "mongoose";
import Discount, { DiscountType } from "../models/discount";
import { joinLocation } from "../utils/joinLocation";
import { generateOneSingleEmbedding } from "../middleware/event_des_embed";
import * as eventEmbeddedDescriptionConstants from "../utils/constants/event-embedded-description";
import { Tensor } from "@huggingface/transformers/types/utils/tensor";

const router = express.Router();

router.post("/test", verifyToken, async (req: Request, res: Response) => {
  res.status(200).json({ message: "Test successful" });
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const now = new Date(); // Gets the current date and time
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Define an aggregation pipeline to find and process events
    const pipeline: mongoose.PipelineStage[] = [
      { $match: { startTime: { $gte: now } } },
      { $sort: { startTime: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "tickets",
          localField: "_id",
          foreignField: "eventId",
          as: "tickets",
        },
      },
      { $unwind: "$tickets" },
      {
        $group: {
          _id: "$_id",
          title: { $first: "$title" },
          description: { $first: "$description" },
          startTime: { $first: "$startTime" },
          endTime: { $first: "$endTime" },
          venueId: { $first: "$venueId" },
          capacity: { $first: "$capacity" },
          postalCode: { $first: "$postalCode" },
          organizerId: { $first: "$organizerId" },
          location: { $first: "$location" },
          category: { $first: "$category" },
          eventType: { $first: "$eventType" },
          artistName: { $first: "$artistName" },
          imageUrls: { $first: "$imageUrls" },
          roomChatLink: { $first: "$roomChatLink" },
          minPrice: { $min: "$tickets.price" },
        },
      },
    ];

    const events = await Event.aggregate(pipeline);

    // Count total documents for pagination metadata
    const total = await Event.countDocuments({ startTime: { $gte: now } });

    res.status(200).json({
      events,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch events:", error);
    res
      .status(500)
      .json({ message: "Internal server error, unable to fetch events." });
  }
});

router.post("/", verifyToken, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    return res.status(400).json({ message: "User does not exists!" });
  }

  const {
    title,
    description,
    startTime,
    endTime,
    venueId,
    capacity,
    location,
    category,
    eventType,
    artistName,
    imageUrls,
    roomChatLink,
  } = req.body;

  if (
    !title ||
    !description ||
    !startTime ||
    !endTime ||
    !endTime ||
    !location ||
    !category ||
    !eventType ||
    !imageUrls
  ) {
    return res.status(400).json({
      message:
        "Missing required fields: Ensure all fields including title, description, start time, end time, location, category, artist name, image URLs are provided.",
    });
  }
  const existingEvent = await Event.findOne({ title, startTime, location });
  if (existingEvent) {
    return res.status(400).json({
      message:
        "An event with the same title, start time and location already exists!",
    });
  }
  const fullAddress = joinLocation(location);
  const event = new Event({
    title,
    description,
    startTime,
    endTime,
    venueId: venueId ? new mongoose.Types.ObjectId(venueId) : undefined,
    capacity,
    organizerId: user._id,
    location: {
      ...location,
      fullAddress,
    },
    category,
    eventType,
    artistName: artistName ? artistName : undefined,
    imageUrls,
    roomChatLink,
  });
  try {
    await event.save();
    return res.status(200).json(event);
  } catch (error) {
    console.error("Failed to create event:", error);
    return res
      .status(500)
      .json({ message: "Failed to create event due to an internal error" });
  }
});

router.post(
  "/:eventId/tickets",
  verifyToken,
  async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const { tickets } = req.body;

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({
        message: "Missing required ticket details or tickets array is empty.",
      });
    }

    try {
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found." });
      }

      for (const ticketData of tickets) {
        const { type, price, quantityAvailable, seatNumber, discount } =
          ticketData;

        if (!type || price == null || quantityAvailable == null) {
          return res
            .status(400)
            .json({ message: "Missing required ticket details." });
        }
        const isFree = price === 0 || price === 0.0 || price === 0.0;
        const ticket = new Ticket({
          eventId,
          status: "active",
          type,
          price,
          quantityAvailable,
          seatNumber,
          isFree,
        });

        await ticket.save();
        event.tickets.push(ticket._id);

        if (discount) {
          const {
            code,
            discount: amount,
            type,
            validUntil,
            usageLimit,
          } = discount;
          if (!code || !amount || !validUntil || !usageLimit) {
            return res
              .status(400)
              .json({ message: "Missing required discount details." });
          }
          let discountData: DiscountType = {
            eventId: new mongoose.Types.ObjectId(event._id),
            ticketId: ticket._id,
            code,
            validUntil,
            isActive: true,
            usageLimit,
            usedCount: 0,
          };
          if (type === "percentage") {
            discountData = { ...discountData, percentage: amount };
          } else if (type === "number") {
            discountData = { ...discountData, number: amount };
          }

          const createdDiscount = new Discount(discountData);
          await createdDiscount.save();
        }
      }

      await event.save();

      return res.status(201).json({
        message: "Tickets created successfully",
      });
    } catch (error) {
      console.error("Failed to create tickets:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.delete(
  "/:ticketId/deleteTicket",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const ticket = await Ticket.findById(req.query.ticketId);
      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }
      const event = await Event.findOneAndUpdate(
        { _id: ticket.eventId, organizerId: userId },
        { $pull: { tickets: req.query.ticketId } },
        { new: true } // Return the updated document
      );
      if (!event) {
        return res.status(404).send({
          message: "Event of this ticket not found/not created by this user",
        });
      }
      await Ticket.findByIdAndDelete(req.query.ticketId);
      res
        .status(200)
        .json({ message: "Ticket deleted successfully", deleted: ticket });
    } catch (error) {
      console.log("Fail to delete ticket", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);
router.delete(
  "/:eventId/deleteEvent",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const { eventId } = req.params; // Extract eventId from params
      console.log(eventId);
      // Find and delete the event
      const event = await Event.findOneAndDelete({
        organizerId: userId,
        _id: eventId,
      });

      if (!event) {
        return res
          .status(404)
          .json({ message: "Event not found/not created by this user" });
      }

      // Delete all tickets associated with the event
      await Ticket.deleteMany({ eventId });

      res
        .status(200)
        .json({ message: "Event deleted successfully", deleted: event });
    } catch (error) {
      console.log("Fail to delete event", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

router.patch(
  "/:ticketId/updateTicket",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      let ticket = await Ticket.findById(req.query.ticketId);
      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }
      const event = await Event.findOne({
        _id: ticket.eventId,
        organizerId: userId,
      });
      if (!event) {
        return res.status(404).send({
          message: "Event of this ticket not found/not created by this user",
        });
      }
      ticket = await Ticket.findByIdAndUpdate(req.query.ticketId, req.body, {
        new: true,
      });
      res
        .status(200)
        .json({ message: "Ticket updated successfully", updated: ticket });
    } catch (error) {
      console.log("Fail to update ticket", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

router.get("/:eventId/details", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    // Populate the 'tickets' field when fetching the event
    const event = await Event.findById(eventId)
      .populate({
        path: "organizerId",
        select: "username imageUrl",
      })
      .populate("tickets")
      .exec();

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    return res.status(200).json(event);
  } catch (error) {
    console.error("Failed to fetch event:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/filter", async (req: Request, res: Response) => {
  try {
    let {
      sort,
      location,
      keyword,
      startTime,
      endTime,
      priceMin,
      priceMax,
      category,
      eventType,
    } = req.query;

    if (location == undefined) {
      location = "";
    }

    if (category == "All event categories" || category == undefined) {
      category = "";
    }

    if (eventType == "All event types" || eventType == undefined) {
      eventType = "";
    }
    const regexEventType = new RegExp(String(eventType), "i"); // Create a regular expression with the variable and make it case-insensitive
    const regexCategory = new RegExp(String(category), "i");
    // const regexKeyword = new RegExp(String(keyword), "i");
    const regexLocation = new RegExp(String(location), "i");
    //if no endDate input, we let it be one day after startDate (so that we only filter by  event within the day)
    if (startTime && !endTime) {
      const date = new Date(String(startTime).split("T")[0]);
      // Add one day to the Date object
      date.setDate(date.getDate() + 1);
      // Convert the modified Date object back to a string
      endTime = date.toISOString();
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 8;
    const skip = (page - 1) * limit;

    console.log(location);

    const pipeline: mongoose.PipelineStage[] = [
      {
        $match: {
          $and: [
            // {
            //   $or: [
            //     { description: { $regex: regexKeyword } },
            //     { title: { $regex: regexKeyword } },
            //     { "location.fullAddress": { $regex: regexKeyword } },

            //     { artistName: { $regex: regexKeyword } },
            //   ],
            // },
            { "location.fullAddress": { $regex: regexLocation } },
            { eventType: { $regex: regexEventType } },
            { category: { $regex: regexCategory } },
          ],
        },
      },
      {
        $lookup: {
          from: "tickets",
          localField: "_id",
          foreignField: "eventId",
          as: "tickets",
        },
      },
      {
        $addFields: {
          minPrice: { $min: "$tickets.price" },
          maxPrice: { $max: "$tickets.price" },
        },
      },
      {
        $match: {
          $or: [
            {
              minPrice: {
                $gte: priceMin ? parseFloat(priceMin as string) : -Infinity,
                $lte: priceMax ? parseFloat(priceMax as string) : Infinity,
              },
            },
            {
              maxPrice: {
                $gte: priceMin ? parseFloat(priceMin as string) : -Infinity,
                $lte: priceMax ? parseFloat(priceMax as string) : Infinity,
              },
            },
            {
              $and: [
                {
                  minPrice: {
                    $lte: priceMin ? parseFloat(priceMin as string) : -Infinity,
                  },
                },
                {
                  maxPrice: {
                    $gte: priceMax ? parseFloat(priceMax as string) : Infinity,
                  },
                },
              ],
            },
          ],
        },
      },
    ];

    //if date is given, match by date as well
    if (startTime) {
      pipeline.push({
        $match: {
          $or: [
            {
              startTime: {
                $gte: new Date(String(startTime)),
                $lte: new Date(String(endTime)),
              },
            },
            {
              endTime: {
                $gte: new Date(String(startTime)),
                $lte: new Date(String(endTime)),
              },
            },
            {
              $and: [
                { startTime: { $lte: new Date(String(startTime)) } },
                { endTime: { $gte: new Date(String(endTime)) } },
              ],
            },
          ],
        },
      });
    }
    
    // if (keyword) {
    //   const keywordsEmbedded = await generateOneSingleEmbeddings(String(keyword));
    //   pipeline.push({
    // }
    /*
    must have relevance above a threshold
    sort by whatever needed - if not chosen, default to sort by relevance
    */

    let eventMatchedAll = await Event.aggregate(pipeline);
    const total = eventMatchedAll.length;

    switch (sort) {
      case "Soonest":
        pipeline.push({ $sort: { startTime: 1 } }, { $sort: { endTime: 1 } });
        break;
      case "Latest":
        pipeline.push({ $sort: { startTime: -1 } }, { $sort: { endTime: -1 } });
        break;
      case "Price low to high":
        pipeline.push({ $sort: { minPrice: 1 } }, { $sort: { maxPrice: 1 } });
        break;
      case "Price high to low":
        pipeline.push({ $sort: { minPrice: -1 } }, { $sort: { maxPrice: -1 } });
        break;
      // case "Relevance":
      //   pipeline.push({ $sort: { title: 1 } });
      //   break;
      default:
        break;
        ``;
    }
    pipeline.push({ $skip: skip }, { $limit: limit });
    const eventMatched = await Event.aggregate(pipeline);

    res.status(200).json({
      eventMatched,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch event:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete(
  "/:eventId/deleteEvent",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const event = await Event.findOneAndDelete({
        $and: [{ organizerId: userId }, { _id: req.params.eventId }],
      });

      if (!event) {
        return res
          .status(404)
          .json({ message: "Event not found/not created by this user" });
      }
      await Ticket.deleteMany({ eventId: req.params.eventId });
      res
        .status(200)
        .json({ message: "Event deleted successfully", deleted: event });
    } catch (error) {
      console.log("Fail to delete event", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

router.put(
  "/:eventId/updateEvent",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      console.log("Request to update event:", req.params.eventId, req.body);

      // Extract location details from req.body
      const { city, postalCode, country, state } = req.body.location || {};

      // Construct the fullAddress field
      const fullAddress =
        `${city || ""}, ${state || ""}, ${postalCode || ""}, ${country || ""}`
          .trim()
          .replace(/\s*,\s*$/, "");

      // Update req.body with the constructed location object
      req.body.location = {
        ...req.body.location,
        fullAddress,
      };

      const event = await Event.findOneAndUpdate(
        { $and: [{ organizerId: req.userId }, { _id: req.params.eventId }] },
        req.body,
        { new: true }
      );

      if (!event) {
        return res
          .status(404)
          .json({ message: "Event not found/not created by this user" });
      }

      res
        .status(200)
        .json({ message: "Event updated successfully", updated: event });
    } catch (error) {
      console.error("Failed to update event:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

//route to fetch all event created by the given user
router.get("/fetch", verifyToken, async (req: Request, res: Response) => {
  try {
    const event = await Event.find({ organizerId: req.userId });

    if (!event || event.length === 0) {
      return res
        .status(404)
        .json({ message: "Event not found/not created by this user" });
    }
    res.status(200).json({
      message: "Event created by this user fetched successfully",
      event: event,
    });
  } catch (error) {
    console.error("Failed to fetch event:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/addEmbeddedDescriptions", async (req: Request, res: Response) => {
  try {
    const batchSize = eventEmbeddedDescriptionConstants.eventEmbeddedDesWriteBatchSize;
    const eventsId: string[] = req.body.eventsId || [];

    const embeddedDescriptions: Record<string, number[]> = {};
    for (const id of eventsId) {
      embeddedDescriptions[id] = (await generateOneSingleEmbedding(id));
    }

    for (let i = 0; i < eventsId.length; i += batchSize) {
      const batch = eventsId.slice(i, i + batchSize);

      const ops = batch.map((id) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(id) },
          update: { $set: { embeddedDescription: embeddedDescriptions[id] } },
        },
      }));

      if (ops.length > 0) {
        await Event.collection.bulkWrite(ops, { ordered: false });
      }

    }

    res.status(200).json({ message: "Embedded descriptions updated successfully" });
  } catch (error) {
    console.error("Failed to add embedded description:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/addOneEmbeddedDes", async (req: Request, res: Response) => {
  try {
    const eventId: string = req.body.eventId;
    let theEvent = await Event.findById(eventId);
    if (!theEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    const embeddedDescriptions = (await generateOneSingleEmbedding(theEvent.description));
    const batch = [eventId];

    const ops = batch.map((id) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id) },
        update: { $set: { embeddedDescription: embeddedDescriptions} },
      },
    }));

    if (ops.length > 0) {
      await Event.collection.bulkWrite(ops, { ordered: false });
    }
    console.log(embeddedDescriptions);
    res.status(200).json({ message: "Embedded descriptions updated successfully", data: embeddedDescriptions });
  } catch (error) {
    console.error("Failed to add embedded description:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/allEventsId", async (req: Request, res: Response) => {
  try {
    const events = await Event.find({}, { _id: 1 }); // Fetch only the _id field
    const eventIds = events.map(event => event._id); // Extract the _id values    

    res.status(200).json({ eventIds });

  } catch (error) {
    console.error("Failed to fetch event IDs:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// // Preserve events and their tickets in-place: for each id in `eventsId`,
// // re-write (replace) the event document and any tickets that reference it using upsert.
// // This preserves the original `_id` values (no duplicates) and is suitable for
// // re-inserting or normalizing documents.
// router.get(
//   "/preserve",
//   async (req: Request, res: Response) => {
//     try {
//       const events = await Event.find({}, { _id: 1 }); // Fetch only the _id field
//       const eventsId = events.map(event => event._id); // Extract the _id values    
//       if (!Array.isArray(eventsId) || eventsId.length === 0) {
//         return res.status(400).json({ message: "eventsId array is required" });
//       }
//       console.log("Preserving events:", eventsId);

//       const result: Record<
//         string,
//         { event: boolean; tickets: Record<string, boolean> }
//       > = {};

//       console.log("pass2");

//       for (const id of eventsId) {
//         try {
//           const eventDoc = await Event.findById(id).lean();
//           if (!eventDoc) {
//             result[id] = { event: false, tickets: {} };
//             continue;
//           }

//           // Replace the event document with an upsert to preserve the _id
//           await Event.replaceOne({ _id: eventDoc._id }, eventDoc as any, {
//             upsert: true,
//           });

//           // Find tickets that reference this event and upsert them as well
//           const tickets = await Ticket.find({ eventId: id }).lean();
//           const ticketResults: Record<string, boolean> = {};
//           for (const ticket of tickets) {
//             try {
//               await Ticket.replaceOne({ _id: ticket._id }, ticket as any, {
//                 upsert: true,
//               });
//               ticketResults[String(ticket._id)] = true;
//             } catch (tErr) {
//               console.error(`Failed to upsert ticket ${ticket._id}:`, tErr);
//               ticketResults[String(ticket._id)] = false;
//             }
//           }

//           result[id] = { event: true, tickets: ticketResults };
//         } catch (err) {
//           console.error(`Failed to preserve event ${id}:`, err);
//           result[id] = { event: false, tickets: {} };
//         }
//       }

//       res.status(200).json({ preserved: result });
//     } catch (error) {
//       console.error("Failed to preserve events:", error);
//       res.status(500).json({ message: "Internal server error" });
//     }
//   },
// );

router.post("/searchEvents", async (req: Request, res: Response) => {
  // const query = req.body.query as string;
  const query = "abc";
  if (!query) {
    return res.status(400).json({ message: "Missing query in request body" });
  }

  try {
    const embedding = await generateOneSingleEmbedding(query);
    // const embedding: number[] = [-0.08916926383972168,-0.019315414130687714,-0.08188510686159134,0.046029504388570786,-0.01497794222086668,0.029589885845780373,0.12268488854169846,0.026163125410676003,0.012927664443850517,-0.07275070250034332,0.012152568437159061,-0.13947932422161102,-0.010118935257196426,0.0005644005723297596,-0.03445117175579071,-0.020313821732997894,-0.032206419855356216,-0.07092456519603729,-0.024362608790397644,0.017487747594714165,-0.09292645007371902,-0.0190615002065897,-0.10059186071157455,-0.04417134076356888,-0.05426204204559326,-0.060375913977622986,-0.03732734173536301,0.06275622546672821,-0.002393305068835616,-0.10136648267507553,0.08705791085958481,0.05795019492506981,0.08580974489450455,0.06778686493635178,0.13630110025405884,0.02494203858077526,-0.0009988616220653057,-0.004910278134047985,0.005374887026846409,0.010965060442686081,0.002961308229714632,0.0017451338935643435,0.12116960436105728,0.061781276017427444,-0.040876440703868866,0.07051053643226624,-0.009459193795919418,-0.02242259867489338,-0.0506444126367569,0.02793068252503872,0.02351376786828041,0.0010131942108273506,-0.03857832029461861,0.03335059806704521,0.028582720085978508,0.041969817131757736,-0.017126411199569702,-0.01973041333258152,0.024046076461672783,0.032881349325180054,0.11348306387662888,0.0050095487385988235,-0.015615593641996384,-0.08924231678247452,0.034239526838064194,0.003598259761929512,-0.0567447766661644,-0.11483689397573471,0.036931876093149185,-0.04316849634051323,-0.03700730949640274,0.11837024986743927,0.0023145622108131647,0.01155004557222128,0.02664985880255699,0.025551235303282738,-0.05826039984822273,-0.01364083681255579,0.06203781068325043,-0.02831440232694149,-0.030713729560375214,-0.06608360260725021,-0.04775124043226242,0.07780909538269043,0.03354049101471901,-0.030432142317295074,0.016323966905474663,0.011823896318674088,0.019914278760552406,0.00519839720800519,0.04509769380092621,0.041066817939281464,0.05006600171327591,-0.06535610556602478,-0.07465337961912155,0.04093321040272713,0.08669118583202362,-0.014691991731524467,-0.08565597236156464,0.12751945853233337,0.02800799161195755,0.06404845416545868,-0.03414079546928406,0.06755318492650986,0.0584319531917572,0.023362601175904274,-0.05926930531859398,0.09685543179512024,-0.04076554998755455,0.009450455196201801,-0.05483091622591019,0.0397355854511261,-0.01737244427204132,-0.01084282249212265,0.07821032404899597,0.006648121401667595,0.0032887340057641268,0.006601112429052591,0.04223573952913284,-0.007659896742552519,-0.005916989874094725,-0.01064314879477024,-0.002197497058659792,-0.04346931353211403,-0.14306366443634033,-0.06746093928813934,-0.017456555739045143,8.066637495318001e-33,-0.06245758384466171,-0.010829496197402477,0.03584682196378708,-0.015589162707328796,-0.016018284484744072,0.011936362832784653,0.015651151537895203,-0.03228740394115448,-0.0136326365172863,0.010337761603295803,-0.070768341422081,-0.015693828463554382,0.009868291206657887,-0.0003888258943334222,0.025261161848902702,-0.05920284986495972,0.013775276951491833,0.019423674792051315,-0.09159977734088898,-0.04713462293148041,-0.00019939990306738764,0.01301390491425991,-0.014166563749313354,0.018481435254216194,0.011451705358922482,0.06764455139636993,-0.02094992995262146,-0.032078806310892105,0.09222931414842606,0.03980843722820282,0.032901108264923096,0.0051892222836613655,-0.06236691027879715,-0.00015270689618773758,0.013288157060742378,-0.01132562942802906,-0.02468325011432171,-0.07508011162281036,0.0022747006732970476,-0.032040130347013474,0.045909713953733444,0.032555948942899704,-0.05720102787017822,-0.05006773769855499,0.013927670195698738,0.013849915936589241,0.08551659435033798,0.10314598679542542,0.09884396940469742,0.007332275155931711,-0.07730131596326828,-0.010330921038985252,-0.101780004799366,-0.0429115854203701,-0.04637477919459343,-0.10080664604902267,0.010656100697815418,-0.020372817292809486,-0.01879347860813141,-0.033983368426561356,0.06065787747502327,0.061260953545570374,-0.02761535346508026,-0.0678117424249649,0.020090529695153236,-0.06489957123994827,-0.015259092673659325,-0.06580235064029694,-0.0010878145694732666,-0.1228746697306633,-0.05636260285973549,-0.0693928599357605,0.11677761375904083,-0.002864290028810501,-0.026598887518048286,0.009480737149715424,-0.024368809536099434,-0.03388779237866402,-0.05078664422035217,0.016763707622885704,-0.052889782935380936,0.01967661827802658,-0.06538595259189606,-0.03500845655798912,-0.020054299384355545,0.06420565396547318,-0.022585762664675713,-0.07048706710338593,0.0031276096124202013,0.025957155972719193,-0.05080043151974678,-0.010774741880595684,-0.01879400946199894,0.0038050070870667696,-0.026002438738942146,-7.840438586757207e-33,-0.013416825793683529,-0.03287987411022186,-0.04187272861599922,-0.03545491397380829,-0.004901471547782421,-0.04564163461327553,0.008967271074652672,-0.011229781433939934,0.035518575459718704,-0.006712939124554396,0.07095847278833389,-0.0847679078578949,0.04366488382220268,-0.07420246303081512,0.0034009250812232494,0.0021940930746495724,0.04135710746049881,0.017520776018500328,0.01019502803683281,0.02837783843278885,-0.0852896198630333,0.033036813139915466,-0.011391157284379005,0.06623682379722595,-0.04289621487259865,-0.0048287236131727695,0.04531479999423027,0.04374592751264572,0.07485887408256531,0.01939273066818714,0.007107628509402275,-0.015359338372945786,-0.023559920489788055,0.12039743363857269,-0.11363467574119568,-0.0752665176987648,0.11009635031223297,-0.004543098155409098,0.020994950085878372,-0.021572129800915718,0.0316958874464035,0.0020373968873173,-0.002954633440822363,0.08466456830501556,0.03528651222586632,0.06931058317422867,-0.0059469593688845634,-0.04107160121202469,0.032071538269519806,0.032322898507118225,0.02268403023481369,-0.03710068017244339,-0.03758034110069275,0.043762508779764175,0.0764385387301445,0.04984614625573158,0.01390081923455,0.004077363293617964,0.029556114226579666,-0.03318477049469948,0.13679713010787964,0.04240357130765915,-0.03793144226074219,0.04247065261006355,0.05307024344801903,0.00710301473736763,-0.03749711066484451,0.061077557504177094,0.036712247878313065,-0.08205140382051468,-0.027322202920913696,0.030170941725373268,0.000984812038950622,0.026411501690745354,0.07736973464488983,-0.04331948608160019,0.03646080940961838,0.03442775085568428,-0.012284533120691776,0.034194059669971466,0.000525518087670207,0.02155936509370804,0.007746330928057432,-0.020375873893499374,0.02290888875722885,-0.06258164346218109,0.10405344516038895,0.14845310151576996,0.017889607697725296,-0.05029913783073425,-0.044092047959566116,0.012242241762578487,-0.027630388736724854,-0.09132710099220276,0.03432716056704521,-2.7460361096132146e-8,-0.022065846249461174,-0.05329027771949768,-0.002100949175655842,-0.03514528274536133,0.05001000687479973,0.02818458527326584,-0.016856370493769646,0.011661303229629993,-0.02974759228527546,-0.020788870751857758,0.05147966742515564,0.03211984410881996,-0.021471604704856873,-0.003641819581389427,-0.037968095391988754,-0.04138727858662605,-0.13713347911834717,0.07326829433441162,0.016846945509314537,-0.01720261014997959,0.07283810526132584,-0.041676245629787445,0.06064373627305031,-0.04927477613091469,-0.007993978448212147,-0.038130149245262146,0.036384984850883484,0.12564612925052643,-0.0861092284321785,0.02622092515230179,0.006384798791259527,0.008919073268771172,-0.07773104310035706,-0.11247187852859497,0.0072188242338597775,0.01462624128907919,0.0029824371449649334,0.0033377096988260746,0.03381945565342903,-0.028774842619895935,0.06083454191684723,0.03709648922085762,-0.010915103368461132,0.04086733236908913,0.016596326604485512,-0.0015955694252625108,-0.01879131607711315,0.0005620212177745998,-0.02780897356569767,-0.0223302710801363,-0.08697868138551712,-0.004043768160045147,0.05681198835372925,-0.03140179067850113,-0.02160007506608963,-0.015239784494042397,-0.04754650220274925,0.03641684353351593,-0.028389541432261467,0.03715038672089577,0.04985121265053749,0.0656503438949585,-0.026781445369124413,-0.1102292612195015];
    const results = await Event.aggregate([
      {
        $vectorSearch: {
          index: "default",
          path: "embeddedDescription",
          queryVector: embedding,
          numCandidates: 200,
          limit: 10
        }
      },
    ]);

    console.log("Vector search results:", results);

    res.status(200).json({ results });

  } catch (error) {
    console.error("Vector search failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


export default router;
