import jsSHA from 'jssha';

const SALT = process.env.MY_ENV_VAR;
// export MY_ENV_VAR='cents'

export const getHash = (input) => {
  const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
  const unhashedStr = `${input}-${SALT}`;
  shaObj.update(unhashedStr);
  return shaObj.getHash('HEX');
};
