const db = require('../../data/db-config');
const { dbOps, formatCohortSubmissions } = require('../../lib');
const faceoff = require('./faceoffGeneration');
const { result, clusterGeneration } = require('./modHelpers');

/**
 * Queries the database for a list of all current cohorts
 * @returns {Promise} returns a promise that resolves to a list of cohort objects
 */
const getCohorts = () => {
  return db('Cohorts');
};

/**
 * Attempts to add another cohort to the database
 * @param {Object} cohort a cohort object (or array of cohorts) to be added
 * @param {number} cohort.StoryID the id of the cohort's curernt story
 * @return {Promise} returns a promise that resolves to the ID(s) of the new cohort(s)
 */
const addCohort = (cohort) => {
  return db('Cohorts').insert(cohort).returning('ID');
};

/**
 * Returns a hash table list of all submissions for a given cohort. Response documentation
 * can be found on the GET /mod/submissions?cohortId={} endpoint.
 * @param {number} CohortID the id of the desired cohort
 * @returns {Promise} a promise that resolves to a table of submissions
 */
const getSubmissionsByCohort = async (CohortID) => {
  return db.transaction(async (trx) => {
    try {
      const cohorts = await trx('Cohorts').where({ ID: CohortID });
      // If the cohort ID is invalid, this will throw a 404 error
      if (cohorts.length <= 0) throw new Error('NotFound');

      const data = await dbOps.getAllSubmissionsByCohort(trx, CohortID);
      return formatCohortSubmissions(data);
    } catch (err) {
      throw new Error(err.message);
    }
  });
};

/**
 * Attempts to update the submission status of a given post.
 * @param {number} ID the id of the submission to update
 * @param {Object} changes the desired changes for the given submission
 * @param {string} changes.Status a string containing one of the following flags: 'APPROVED', 'REJECTED'
 * @returns {Promise} returns a promise that resolves to a count of updated rows
 */
const moderatePost = (ID, changes) => {
  return db('Submissions').where({ ID }).update(changes);
};

/**
 * A database transaction that runs a series of processes on the server. This should be run
 * every wednesday night after children have assigned points to generate matchups. This is
 * essentially a saga-patterned transaction with rollback.
 * 1. Gets a list of all submissions, formats, and sorts them by squad
 * 2. Generates 4 matchups for each squad for children to vote on the following day
 */
const generateFaceoffs = () => {
  return db.transaction(async (trx) => {
    try {
      const data = await faceoff.getSubmissionsWithPoints(trx);
      const formattedData = faceoff.formatPointSums(data);
      const squads = faceoff.sortBySquad(Object.values(formattedData));
      const matchups = faceoff.groupOnPoints(squads);

      const IDs = await trx('Faceoffs').insert(matchups).returning('ID');

      return IDs;
    } catch (err) {
      console.log({ err: err.message });
      throw new Error(err.message);
    }
  });
};

/**
 * A database transaction that can be triggered to run a series of processes on the server.
 * This should be run at the end of every week after the children have voted:
 * 1. Tallies up the votes for each faceoff
 * 2. Updates the Faceoffs table with the victor information
 * 3. Updates the Teams and Squads tables with the winner and points totals
 */
const calculateResultsForTheWeek = () => {
  return db.transaction(async (trx) => {
    try {
      const results = await result.countVotes(trx);
      const squadTotals = await result.updateFaceoffs(trx, results);
      await result.updateTeamsAndSquads(trx, squadTotals);
    } catch (err) {
      console.log({ err: err.message });
      throw new Error(err.message);
    }
  });
};

/**
 * Truncates tables in order to reset the game state. Keeps all submissions intact.
 * This should be run for testing purposes only.
 * It will truncate all rows in the following tables:
 * 1. Votes
 * 2. Teams
 * 3. Points
 * 4. Faceoffs
 * 5. Squads
 */
const resetGameForTesting = async () => {
  return db.raw(
    `TRUNCATE 
    public."Votes", 
    public."Teams", 
    public."Points", 
    public."Faceoffs", 
    public."Squads", 
    public."Members" 
    CASCADE`
  );
};

module.exports = {
  clusterGeneration,
  getCohorts,
  addCohort,
  getSubmissionsByCohort,
  moderatePost,
  generateFaceoffs,
  calculateResultsForTheWeek,
  resetGameForTesting,
};
